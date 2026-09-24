import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

import { rateLimit } from "express-rate-limit";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { pathToFileURL } from "node:url";
import { MAX_UPLOAD, MAX_REQUEST, allowedTypes, validateFiles, createQuotaConsumer } from "./security.js";

const invoiceSchema = {
  type: "object",
  properties: {
    vendor: { type: "string" },
    invoiceNumber: { type: "string" },
    invoiceDate: { type: "string", description: "YYYY-MM-DD when possible" },
    subtotal: { type: "number" },
    tax: { type: "number" },
    total: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          upc: { type: "string" },
          category: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: "number", description: "Invoice unit cost, not extended line total" },
          srp: { type: "number" },
          lineTotal: { type: "number" }
        },
        required: ["description", "upc", "category", "quantity", "unitPrice", "srp", "lineTotal"]
      }
    }
  },
  required: ["vendor", "invoiceNumber", "invoiceDate", "subtotal", "tax", "total", "items"]
};

export function createApp({ verifyToken, consumeQuota, generate, origins = [], validate = validateFiles }) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: "Origin not allowed." });
    next();
  });
  app.use(cors({ origin: origins, methods: ["GET", "POST"], allowedHeaders: ["Authorization", "Content-Type"] }));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  const ipLimit = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: "Too many requests. Try again later." } });
  let inFlight = 0;
  const activeUsers = new Set();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD, files: 5, fields: 0, parts: 6, headerPairs: 50 },
    fileFilter(req, file, cb) { cb(allowedTypes.includes(file.mimetype) ? null : new Error("Unsupported type"), allowedTypes.includes(file.mimetype)); }
  }).array("files", 5);
  app.post("/api/parse-invoice", ipLimit, async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
    if (!match) return res.status(401).json({ error: "Authentication required." });
    try {
      req.user = await verifyToken(match[1]);
      if (!req.user?.uid || req.user.firebase?.sign_in_provider === 'anonymous') throw new Error();
    } catch { return res.status(401).json({ error: "Invalid or expired session." }); }
    if (req.user.kokoAccess !== true || !req.user.companyId || !["owner", "admin", "staff"].includes(req.user.role)) return res.status(403).json({ error: "This account does not have workspace access." });
    if (inFlight >= 4 || activeUsers.has(req.user.uid)) return res.status(429).json({ error: "Processing capacity reached. Try again later." });
    inFlight++; activeUsers.add(req.user.uid);
    let released = false;
    req.release = () => { if (!released) { released = true; inFlight--; activeUsers.delete(req.user.uid); } };
    try {
      if (!await consumeQuota(req.user.uid, req.user.companyId)) {
        req.release(); return res.status(429).json({ error: "Invoice scanning limit reached. Try again later." });
      }
    } catch {
      req.release(); return res.status(503).json({ error: "Invoice processing unavailable." });
    }
    if (Number(req.headers['content-length']) > MAX_REQUEST) {
      req.release(); return res.status(413).json({ error: "Upload is too large." });
    }
    let bytes = 0;
    const timer = setTimeout(() => { req.destroy(); req.release(); }, 30000);
    req.once('aborted', () => { clearTimeout(timer); req.release(); });
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST && !res.headersSent) { res.status(413).json({ error: "Upload is too large." }); req.destroy(); }
    });
    upload(req, res, err => {
      clearTimeout(timer);
      if (res.headersSent || req.aborted || res.destroyed) { req.release(); return; }
      if (err) { req.release(); return res.status(400).json({ error: "Invalid upload. Use up to 5 files totaling 20 MB." }); }
      next();
    });
  }, async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length || files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD) {
      return res.status(400).json({ error: "Upload 1–5 supported files totaling at most 20 MB." });
    }
    try { await validate(files); }
    catch { return res.status(400).json({ error: "Invalid upload. Maximum 10 pages; images must be at most 25 megapixels and 10,000 pixels per side." }); }
    const prompt = `
You are Koko Invoice, a highly accurate retail and wholesale invoice extraction system.
This request contains ${files.length} page(s)/image(s) of an invoice.

Read every visible line item across all provided pages/images. Do not merge separate rows.
Return monetary fields as numbers with no currency symbols.
For UPCs, return digits only when a UPC is visible; otherwise return an empty string.
"unitPrice" means the vendor invoice unit COST for one sellable/invoiced unit, not the extended total.
"srp" means suggested retail price printed on the invoice. If no SRP is present, use 20% margin on the product.
Choose practical convenience-store categories such as Beverages, Candy & Snacks, Cigarettes, Cigarillos, Snuff,
Beer, Wine, Grocery, Dairy & Ice Cream, Frozen Food, Household Supplies, Medicine, Smoke Shop, Automobile,
Pet Foods, Fishing, Ice Bags, Pipe Tobacco Bag & Tubes, or Miscellaneous.
If a date can be identified, normalize it to YYYY-MM-DD.
Be conservative: never invent a UPC, price, invoice number, or vendor name.
Combine all line items across all pages into a single output object.
`;

    const contents = [{ text: prompt }];
    for (const file of files) {
      contents.push({
        inlineData: {
          mimeType: file.mimetype,
          data: file.buffer.toString("base64")
        }
      });
    }

    const response = await generate({
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
      contents,
      config: {
        abortSignal: AbortSignal.timeout(60000),
        httpOptions: { timeout: 60000 },
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
        responseSchema: invoiceSchema
      }
    });

    const parsed = JSON.parse(response.text);
    if (!Array.isArray(parsed.items)) throw new Error("Invalid AI response");
    res.json(parsed);
  } catch (err) {
    console.error("Invoice processing failed", { name: err?.name });
    if (!res.destroyed) res.status(500).json({ error: "Invoice processing failed." });
  } finally {
    req.release();
  }
});

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.GEMINI_API_KEY || !process.env.FIREBASE_PROJECT_ID) throw new Error("Server configuration is incomplete");
  initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const origins = (process.env.ALLOWED_ORIGINS || "https://koko-invoice.web.app,https://koko-invoice.firebaseapp.com").split(",").map(value => value.trim());
  if (process.env.NODE_ENV !== "production") origins.push("http://localhost:5173");
  const app = createApp({
    verifyToken: async token => {
      const user = await getAuth().verifyIdToken(token, true);
      const access = (await getFirestore().collection('_access').doc(user.uid).get()).data();
      if (!access?.active || access.companyId !== user.companyId || access.role !== user.role) throw new Error('Access revoked');
      return user;
    },
    consumeQuota: createQuotaConsumer(getFirestore()),
    generate: options => ai.models.generateContent(options), origins
  });
  const server = app.listen(Number(process.env.PORT || 8787));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
}
