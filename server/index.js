import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  const customKey = req.headers["x-api-key"] || req.query.apiKey;
  const apiKey = customKey || process.env.GEMINI_API_KEY;
  res.json({
    ok: true,
    geminiConfigured: Boolean(apiKey),
    hasCustomKey: Boolean(customKey),
    source: customKey ? "custom" : (process.env.GEMINI_API_KEY ? "env" : "none"),
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash"
  });
});

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

function normalizeUpc(v = "") {
  return String(v).replace(/\D/g, "").replace(/^0+(?=\d{8,14}$)/, "");
}

function matchPriceBook(items, products) {
  const byUpc = new Map();
  for (const p of products) {
    const k = normalizeUpc(p.upc);
    if (k) byUpc.set(k, p);
  }
  return items.map(item => {
    const p = byUpc.get(normalizeUpc(item.upc));
    const matchedRetail = p ? Number(p.retail || 0) : null;
    const invoiceSrp = Number(item.srp || 0);
    const comparisonBase = invoiceSrp || Number(item.unitPrice || 0);
    return {
      ...item,
      matchedRetail,
      matchedProduct: p?.name || null,
      priceDifference: matchedRetail == null ? 0 : Number((comparisonBase - matchedRetail).toFixed(2))
    };
  });
}

app.post("/api/parse-invoice", upload.any(), async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"] || req.body.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "GEMINI_API_KEY is not configured. Please add your API key in Settings or set it in server .env." });
    }

    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    if (!files.length) return res.status(400).json({ error: "No invoice files were uploaded." });

    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    for (const file of files) {
      if (!allowed.includes(file.mimetype)) {
        return res.status(415).json({ error: `File ${file.originalname || ""} has invalid type. Use PDF, PNG, JPG/JPEG, or WEBP.` });
      }
    }

    let products = [];
    try { products = JSON.parse(req.body.storeProducts || "[]"); } catch { }

    const ai = new GoogleGenAI({ apiKey });
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

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: invoiceSchema
      }
    });

    const parsed = JSON.parse(response.text);
    parsed.items = matchPriceBook(parsed.items || [], products);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Unable to parse invoice." });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Koko Invoice API running on http://localhost:${port}`));
