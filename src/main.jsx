import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Papa from "papaparse";
import {
  LayoutDashboard, Store, ReceiptText, FileText, CheckSquare, UploadCloud,
  Search, Plus, Trash2, Download, Printer, ChevronDown, Sparkles, X,
  ArrowUpRight, ArrowDownRight, PackageSearch, CircleDollarSign, Building2,
  MoreHorizontal, CheckCircle2, Clock3, CircleDashed, Key, Settings, LogOut,
  User, Lock, Mail, Eye, EyeOff, Check, AlertCircle, ShieldCheck, Pencil, Loader2
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line
} from "recharts";
import "./styles.css";
import { app as firebaseApp, auth } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import {
  seedFirestoreIfEmpty,
  subscribeToFirestore,
  saveStoreDoc,
  deleteStoreDoc,
  saveInvoiceDoc,
  deleteInvoiceDoc,
  saveQuoteDoc,
  deleteQuoteDoc,
  saveTaskDoc,
  deleteTaskDoc
} from "./services/firestoreService.js";

const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n || 0));

function normalizeUpc(v = "") {
  return String(v).replace(/\D/g, "").replace(/^0+(?=\d{4,14}$)/, "");
}

function cleanStr(s = "") {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function matchPriceBook(items, products) {
  if (!products || !products.length) {
    return (items || []).map(item => ({
      ...item,
      matchedRetail: null,
      matchedProduct: null,
      priceDifference: 0
    }));
  }

  const byUpc = new Map();
  const byName = new Map();

  for (const p of products) {
    const k = normalizeUpc(p.upc);
    if (k) byUpc.set(k, p);
    const n = cleanStr(p.name);
    if (n) byName.set(n, p);
  }

  return (items || []).map(item => {
    let p = null;
    const itemUpcClean = normalizeUpc(item.upc);

    // 1. Direct UPC match
    if (itemUpcClean && byUpc.has(itemUpcClean)) {
      p = byUpc.get(itemUpcClean);
    }

    // 2. Substring / Suffix UPC match (handles GTIN-14 vs UPC-A vs EAN-13 differences)
    if (!p && itemUpcClean.length >= 6) {
      for (const prod of products) {
        const prodUpcClean = normalizeUpc(prod.upc);
        if (prodUpcClean && (prodUpcClean.endsWith(itemUpcClean) || itemUpcClean.endsWith(prodUpcClean) || prodUpcClean.includes(itemUpcClean) || itemUpcClean.includes(prodUpcClean))) {
          p = prod;
          break;
        }
      }
    }

    // 3. Product Description / Name match
    if (!p && (item.description || item.name)) {
      const itemDescClean = cleanStr(item.description || item.name);
      if (itemDescClean) {
        if (byName.has(itemDescClean)) {
          p = byName.get(itemDescClean);
        } else {
          for (const prod of products) {
            const prodNameClean = cleanStr(prod.name);
            if (prodNameClean && (itemDescClean.includes(prodNameClean) || prodNameClean.includes(itemDescClean))) {
              p = prod;
              break;
            }
          }
        }
      }
    }

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


function resizeImageIfNeeded(file, maxDimension = 1600) {
  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith("image/")) {
      resolve(file);
      return;
    }
    let resolved = false;
    const done = (resFile) => {
      if (!resolved) {
        resolved = true;
        resolve(resFile);
      }
    };
    const timer = setTimeout(() => done(file), 3000);

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      try {
        let { width, height } = img;
        if (width <= maxDimension && height <= maxDimension) {
          done(file);
          return;
        }
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              done(file);
              return;
            }
            const resizedFile = new File([blob], file.name, { type: "image/jpeg" });
            done(resizedFile);
          },
          "image/jpeg",
          0.85
        );
      } catch {
        done(file);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      done(file);
    };
    img.src = url;
  });
}

async function parseInvoiceDirectWithGemini(apiKey, files, storeProducts, onStatus) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("GEMINI_API_KEY is missing. Please set your Gemini API Key in Settings.");
  }

  if (onStatus) onStatus("Optimizing invoice image(s)...");

  const optimizedFiles = await Promise.all(files.map(f => resizeImageIfNeeded(f)));

  const filePromises = optimizedFiles.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => reject(new Error(`Timeout reading file ${file.name}`)), 10000);
    reader.onload = () => {
      clearTimeout(timer);
      const dataUrl = reader.result;
      const base64 = dataUrl ? dataUrl.split(",")[1] : "";
      let mimeType = file.type || "image/jpeg";
      if (!file.type && file.name) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".pdf")) mimeType = "application/pdf";
        else if (lower.endsWith(".png")) mimeType = "image/png";
        else if (lower.endsWith(".webp")) mimeType = "image/webp";
      }
      resolve({
        inlineData: {
          mimeType: mimeType,
          data: base64
        }
      });
    };
    reader.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Failed to read file ${file.name}`));
    };
    reader.readAsDataURL(file);
  }));

  const inlineFiles = await Promise.all(filePromises);

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
Return JSON matching this exact structure:
{
  "vendor": "string",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "subtotal": 0,
  "tax": 0,
  "total": 0,
  "items": [
    {
      "description": "string",
      "upc": "string",
      "category": "string",
      "quantity": 1,
      "unitPrice": 0,
      "srp": 0,
      "lineTotal": 0
    }
  ]
}
`;

  const contents = [
    {
      parts: [
        { text: prompt },
        ...inlineFiles
      ]
    }
  ];

  const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
  let lastError = null;

  for (const model of models) {
    try {
      if (onStatus) onStatus(`Extracting line items (${model})...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || `Gemini API error (${res.status})`);
      }

      const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("No response text returned from Gemini AI.");

      let cleanedText = rawText.trim();
      if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      }
      const parsed = JSON.parse(cleanedText);
      parsed.items = matchPriceBook(parsed.items || [], storeProducts);
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`Model ${model} attempt failed:`, err.message);
    }
  }

  throw lastError || new Error("Failed to process invoice with Gemini AI.");
}

async function testGeminiApiKeyDirect(apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error("Please enter a Gemini API Key first.");
  const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Respond in JSON: {\"status\":\"ok\"}" }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const data = await res.json();
      if (res.ok) return true;
      lastError = new Error(data.error?.message || `API key test failed (${res.status})`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("API key test failed.");
}

const sampleSeedItems = [
  { upc: "049000050103", description: "Coca-Cola 20oz Bottle 24ct", category: "Beverages", quantity: 2, unitPrice: 1.85, srp: 2.49, lineTotal: 44.40 },
  { upc: "028400090896", description: "Lay's Classic Potato Chips 2.65oz", category: "Candy & Snacks", quantity: 1, unitPrice: 1.95, srp: 2.69, lineTotal: 23.40 },
  { upc: "012000001017", description: "Pepsi Wild Cherry 20oz", category: "Beverages", quantity: 1, unitPrice: 1.85, srp: 2.49, lineTotal: 22.20 },
  { upc: "034000004400", description: "Hershey's Milk Chocolate Bar 1.55oz", category: "Candy & Snacks", quantity: 3, unitPrice: 1.15, srp: 1.69, lineTotal: 41.40 }
];

const seed = {
  stores: [
    {
      id: "s101", name: "Store #101", location: "Main Street", products: [
        { upc: "049000050103", name: "Coca-Cola 20oz", department: "Beverages", retail: 2.49 },
        { upc: "028400090896", name: "Lay's Classic 2.65oz", department: "Candy & Snacks", retail: 2.69 },
        { upc: "012000001017", name: "Pepsi 20oz", department: "Beverages", retail: 2.49 }
      ]
    },
    { id: "s102", name: "Store #102", location: "Lake Avenue", products: [] }
  ],
  invoices: [
    {
      id: "INV-1048", vendor: "Core-Mark", date: "2026-09-01", total: 1847.23, status: "Pending", storeId: "s101", items: 4,
      detail: { invoiceNumber: "INV-1048", vendor: "Core-Mark", invoiceDate: "2026-09-01", total: 1847.23, items: sampleSeedItems }
    },
    {
      id: "INV-1047", vendor: "McLane", date: "2026-08-30", total: 963.55, status: "Paid", storeId: "s101", items: 4,
      detail: { invoiceNumber: "INV-1047", vendor: "McLane", invoiceDate: "2026-08-30", total: 963.55, items: sampleSeedItems }
    },
    {
      id: "INV-1046", vendor: "Great Lakes Beverage", date: "2026-08-28", total: 2211.08, status: "Paid", storeId: "s102", items: 4,
      detail: { invoiceNumber: "INV-1046", vendor: "Great Lakes Beverage", invoiceDate: "2026-08-28", total: 2211.08, items: sampleSeedItems }
    }
  ],
  quotes: [
    { id: "Q-204", client: "Store #101", vendor: "ABC Fixtures", amount: 1250, status: "Open", date: "2026-09-02" }
  ],
  tasks: [
    { id: uid(), title: "Review Core-Mark price increases", tag: "Invoice", done: false },
    { id: uid(), title: "Upload September Store #102 price book", tag: "PriceBook", done: false },
    { id: uid(), title: "Approve cooler quote", tag: "Quote", done: true }
  ]
};

function loadData() {
  try {
    const raw = localStorage.getItem("koko-invoice-data");
    return raw ? { ...seed, ...JSON.parse(raw) } : seed;
  } catch {
    return seed;
  }
}

function loadStoredUser() {
  try {
    const raw = localStorage.getItem("koko-auth-user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function App() {
  const [user, setUser] = useState(loadStoredUser);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("koko-gemini-api-key") || "");
  const [data, setData] = useState(loadData);
  const [page, setPage] = useState("Dashboard");
  const [activeStoreId, setActiveStoreId] = useState(() => loadData().stores?.[0]?.id || "");
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState(null);
  const [firestoreConnected, setFirestoreConnected] = useState(false);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    let unsubAuth = null;
    try {
      unsubAuth = onAuthStateChanged(auth, (fbUser) => {
        if (fbUser) {
          const u = {
            uid: fbUser.uid,
            email: fbUser.email,
            displayName: fbUser.displayName || fbUser.email?.split("@")[0] || "User",
            photoURL: fbUser.photoURL || null,
            isDemo: false
          };
          setUser(u);
          localStorage.setItem("koko-auth-user", JSON.stringify(u));
        }
      });
    } catch (e) {
      console.warn("Firebase auth listener error:", e);
    }
    return () => { if (unsubAuth) unsubAuth(); };
  }, []);

  // Listen to Firestore updates
  useEffect(() => {
    let unsubscribe = null;
    seedFirestoreIfEmpty().then(() => {
      unsubscribe = subscribeToFirestore((cloudData) => {
        setFirestoreConnected(true);
        setData((prev) => ({
          stores: cloudData.stores?.length ? cloudData.stores : prev.stores,
          invoices: cloudData.invoices?.length ? cloudData.invoices : prev.invoices,
          quotes: cloudData.quotes?.length ? cloudData.quotes : prev.quotes,
          tasks: cloudData.tasks?.length ? cloudData.tasks : prev.tasks
        }));
      });
    }).catch(err => {
      console.error("Firestore init error:", err);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const save = async (next) => {
    const prev = data;
    setData(next);
    localStorage.setItem("koko-invoice-data", JSON.stringify(next));

    try {
      const promises = [];
      if (next.stores) {
        promises.push(...next.stores.map(s => saveStoreDoc(s)));
        if (prev.stores) {
          const removed = prev.stores.filter(ps => !next.stores.some(ns => ns.id === ps.id));
          promises.push(...removed.map(rs => deleteStoreDoc(rs.id)));
        }
      }
      if (next.invoices) {
        promises.push(...next.invoices.map(inv => saveInvoiceDoc(inv)));
        if (prev.invoices) {
          const removed = prev.invoices.filter(pi => !next.invoices.some(ni => ni.id === pi.id));
          promises.push(...removed.map(ri => deleteInvoiceDoc(ri.id)));
        }
      }
      if (next.quotes) {
        promises.push(...next.quotes.map(q => saveQuoteDoc(q)));
        if (prev.quotes) {
          const removed = prev.quotes.filter(pq => !next.quotes.some(nq => nq.id === pq.id));
          promises.push(...removed.map(rq => deleteQuoteDoc(rq.id)));
        }
      }
      if (next.tasks) {
        promises.push(...next.tasks.map(t => saveTaskDoc(t)));
        if (prev.tasks) {
          const removed = prev.tasks.filter(pt => !next.tasks.some(nt => nt.id === pt.id));
          promises.push(...removed.map(rt => deleteTaskDoc(rt.id)));
        }
      }
      await Promise.all(promises);
    } catch (err) {
      console.error("Error saving to Firestore:", err);
    }
  };

  const saveApiKey = (key) => {
    const trimmed = (key || "").trim();
    setApiKey(trimmed);
    if (trimmed) {
      localStorage.setItem("koko-gemini-api-key", trimmed);
      notify("API Key saved successfully.");
    } else {
      localStorage.removeItem("koko-gemini-api-key");
      notify("API Key cleared.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Sign out fallback:", e);
    }
    setUser(null);
    localStorage.removeItem("koko-auth-user");
    notify("Logged out successfully.");
  };

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const activeStore = data.stores.find(s => s.id === activeStoreId) || data.stores[0];

  const nav = [
    ["Dashboard", LayoutDashboard],
    ["AI Parser", Sparkles],
    ["Price Books", Store],
    ["Invoices", ReceiptText],
    ["Quotes", FileText],
    ["Tasks", CheckSquare],
    ["Settings", Settings]
  ];

  // If user is not logged in, render the Login Page
  if (!user) {
    return (
      <LoginPage
        onLogin={(u) => {
          setUser(u);
          localStorage.setItem("koko-auth-user", JSON.stringify(u));
          notify(`Welcome back, ${u.displayName || u.email}!`);
        }}
        notify={notify}
        apiKey={apiKey}
        saveApiKey={saveApiKey}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="Koko Invoice Logo" className="brand-logo-img" />
          <div><b>Koko Invoice</b><span>Retail Intelligence</span></div>
        </div>

        <nav>
          {nav.map(([label, Icon]) => (
            <button key={label} className={page === label ? "nav-item active" : "nav-item"} onClick={() => setPage(label)}>
              <Icon size={18} /><span>{label}</span>
              {label === "Settings" && !apiKey && <span className="dot-badge" title="API Key not configured" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile-card">
            <div className="user-avatar">{user.displayName ? user.displayName[0].toUpperCase() : "U"}</div>
            <div className="user-info">
              <strong>{user.displayName || "Store Admin"}</strong>
              <span>{user.email || "demo@kokoinvoice.com"}</span>
            </div>
            <button className="icon-btn logout-btn" title="Sign out" onClick={handleLogout}>
              <LogOut size={16} />
            </button>
          </div>

          <div className="mini-card" style={{ marginTop: 10 }}>
            <Sparkles size={18} />
            <div>
              <strong>Firestore {firestoreConnected ? "Live" : "Syncing..."}</strong>
              <span>Price Books & Ledger DB</span>
            </div>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{page}</h1>
            <p>Manage pricing, invoices and vendor operations in one place.</p>
          </div>
          <div className="top-actions">
            <select value={activeStore?.id || ""} onChange={e => setActiveStoreId(e.target.value)}>
              {data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="ghost settings-quick-btn" onClick={() => setPage("Settings")} title="API Key & Settings">
              <Key size={16} />
              <span className={apiKey ? "key-status-text active" : "key-status-text missing"}>
                {apiKey ? "API Key Set" : "Add API Key"}
              </span>
            </button>
            <button className="primary" onClick={() => setPage("AI Parser")}><UploadCloud size={17} /> Scan invoice</button>
          </div>
        </header>

        <section className="content">
          {page === "Dashboard" && <Dashboard data={data} activeStore={activeStore} save={save} setPage={setPage} />}
          {page === "AI Parser" && <AIParser data={data} save={save} activeStore={activeStore} notify={notify} setPreview={setPreview} apiKey={apiKey} setPage={setPage} />}
          {page === "Price Books" && <PriceBooks data={data} save={save} activeStore={activeStore} activeStoreId={activeStoreId} setActiveStoreId={setActiveStoreId} notify={notify} />}
          {page === "Invoices" && <Invoices data={data} save={save} setPreview={setPreview} />}
          {page === "Quotes" && <Quotes data={data} save={save} />}
          {page === "Tasks" && <Tasks data={data} save={save} />}
          {page === "Settings" && <SettingsView user={user} apiKey={apiKey} saveApiKey={saveApiKey} notify={notify} handleLogout={handleLogout} />}
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
      {preview && <InvoicePreview invoice={preview} stores={data.stores} activeStore={activeStore} onClose={() => setPreview(null)} />}
    </div>
  );
}

async function verifyPasscodeHash(inputCode) {
  const encoder = new TextEncoder();
  const data = encoder.encode(inputCode.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex === "a20a2b7bb0842d5cf8a0c06c626421fd51ec103925c1819a51271f2779afa730";
}

function LoginPage({ onLogin }) {
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const isValid = await verifyPasscodeHash(code);
    if (isValid) {
      onLogin({
        uid: "user-2005",
        email: "admin@kokoinvoice.com",
        displayName: "Store Admin",
        isDemo: true
      });
    } else {
      setError("Incorrect passcode. Please try again.");
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-header">
          <div className="login-brand-icon">
            <img src="/logo.png" alt="Koko Invoice Logo" className="login-logo-img" />
          </div>
          <h2>Koko Invoice</h2>
          <p>Enter access passcode to unlock workspace</p>
        </div>

        {error && (
          <div className="auth-alert error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label>Access Passcode</label>
            <div className="input-icon-wrap large">
              <Lock size={18} />
              <input
                type={showCode ? "text" : "password"}
                placeholder="Enter passcode"
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(""); }}
                autoFocus
                required
              />
              <button
                type="button"
                className="toggle-pass-btn"
                onClick={() => setShowCode(!showCode)}
              >
                {showCode ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="primary auth-submit-btn">
            Unlock Workspace
          </button>
        </form>

        <div className="login-footer-note">
          <ShieldCheck size={14} />
          <span>Protected Passcode Workspace</span>
        </div>
      </div>
    </div>
  );
}

function SettingsView({ user, apiKey, saveApiKey, notify, handleLogout }) {
  const [keyInput, setKeyInput] = useState(apiKey || "");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    setKeyInput(apiKey || "");
  }, [apiKey]);

  const handleSave = (e) => {
    e.preventDefault();
    saveApiKey(keyInput);
    setTestResult(null);
  };

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testGeminiApiKeyDirect(keyInput);
      setTestResult({ ok: true, msg: "Gemini API Key verified & active!" });
    } catch (err) {
      setTestResult({ ok: false, msg: err.message || "Failed to verify API key." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="panel settings-panel">
        <div className="panel-title">
          <div>
            <h3><Key size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />Gemini API Key Configuration</h3>
            <p>Enter your Google Gemini API key to enable instant multi-page AI invoice scanning.</p>
          </div>
          <div className={`key-badge ${apiKey ? "active" : "inactive"}`}>
            {apiKey ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{apiKey ? "Custom Key Configured" : "Server Env / Missing Key"}</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="settings-form">
          <div className="field">
            <label>API Key</label>
            <div className="input-icon-wrap large">
              <Key size={18} />
              <input
                type={showKey ? "text" : "password"}
                placeholder="Paste your Gemini API key (AIzaSy...)"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <button
                type="button"
                className="toggle-pass-btn"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <small className="field-help">
              Don't have a key? Get one for free from {" "}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                Google AI Studio
              </a>.
            </small>
          </div>

          <div className="settings-actions">
            <button type="submit" className="primary">
              <Check size={16} /> Save Key
            </button>
            <button type="button" className="secondary" onClick={handleTestKey} disabled={testing}>
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {apiKey && (
              <button type="button" className="danger-btn" onClick={() => { setKeyInput(""); saveApiKey(""); }}>
                <Trash2 size={16} /> Clear Key
              </button>
            )}
          </div>
        </form>

        {testResult && (
          <div className={`test-result-box ${testResult.ok ? "success" : "error"}`}>
            {testResult.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{testResult.msg}</span>
          </div>
        )}
      </div>

      <div className="panel settings-panel">
        <div className="panel-title">
          <div>
            <h3><User size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />Account & Session Info</h3>
            <p>Currently logged in user profile and authentication context.</p>
          </div>
        </div>

        <div className="user-details-grid">
          <div className="detail-item">
            <span className="label">User Name</span>
            <strong className="value">{user?.displayName || "Store Admin"}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Email Address</span>
            <strong className="value">{user?.email || "N/A"}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Account ID</span>
            <span className="value mono">{user?.uid || "Local Session"}</span>
          </div>
          <div className="detail-item">
            <span className="label">Session Mode</span>
            <span className="value">{user?.isDemo ? "Demo Mode (Client Local)" : "Firebase Authenticated"}</span>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <button className="secondary" onClick={handleLogout}>
            <LogOut size={16} /> Sign Out of Koko Invoice
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ data, activeStore, save, setPage }) {
  const products = activeStore?.products?.length || 0;
  const invoiceTotal = data.invoices.reduce((a, b) => a + Number(b.total || 0), 0);
  const pending = data.invoices.filter(x => x.status === "Pending").length;
  const done = data.tasks.filter(t => t.done).length;
  const progress = data.tasks.length ? Math.round(done / data.tasks.length * 100) : 0;
  const chart = [
    { m: "Apr", revenue: 36200, invoices: 22 },
    { m: "May", revenue: 41400, invoices: 25 },
    { m: "Jun", revenue: 38900, invoices: 24 },
    { m: "Jul", revenue: 46800, invoices: 29 },
    { m: "Aug", revenue: 50100, invoices: 31 },
    { m: "Sep", revenue: 53200, invoices: 34 }
  ];

  const toggleTask = (id) => save({ ...data, tasks: data.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) });

  return <>
    <div className="stats-grid">
      <Stat icon={PackageSearch} label="Active SKUs" value={products.toLocaleString()} note={`${activeStore?.name || "Store"} price book`} />
      <Stat icon={CircleDollarSign} label="Invoice Volume" value={money(invoiceTotal)} note={`${data.invoices.length} invoices tracked`} />
      <Stat icon={ReceiptText} label="Pending Review" value={pending} note="Invoices needing attention" />
      <Stat icon={CheckSquare} label="Tasks Complete" value={`${progress}%`} note={`${done} of ${data.tasks.length} completed`} />
    </div>

    <div className="dashboard-grid">
      <div className="panel chart-panel">
        <div className="panel-title"><div><h3>Revenue overview</h3><p>Monthly business activity</p></div><button className="ghost">Last 6 months <ChevronDown size={15} /></button></div>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#22293a" />
              <XAxis dataKey="m" stroke="#7d879f" axisLine={false} tickLine={false} />
              <YAxis stroke="#7d879f" axisLine={false} tickLine={false} tickFormatter={v => `$${v / 1000}k`} />
              <Tooltip contentStyle={{ background: "#141927", border: "1px solid #293047", borderRadius: 12 }} formatter={v => money(v)} />
              <Bar dataKey="revenue" fill="#8b5cf6" radius={[7, 7, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><div><h3>Tasks</h3><p>{progress}% complete</p></div><button className="icon-btn" onClick={() => setPage("Tasks")}><ArrowUpRight size={18} /></button></div>
        <div className="progress"><span style={{ width: `${progress}%` }} /></div>
        <div className="task-list">
          {data.tasks.slice(0, 5).map(t => (
            <label className="task-row" key={t.id}>
              <input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} />
              <div><strong className={t.done ? "strike" : ""}>{t.title}</strong><span className={`tag ${t.tag.toLowerCase()}`}>{t.tag}</span></div>
            </label>
          ))}
        </div>
      </div>
    </div>

    <div className="panel">
      <div className="panel-title"><div><h3>Recent invoices</h3><p>Latest vendor documents</p></div><button className="ghost" onClick={() => setPage("Invoices")}>View all</button></div>
      <InvoiceTable invoices={data.invoices.slice(0, 5)} compact />
    </div>
  </>;
}

function Stat({ icon: Icon, label, value, note }) {
  return <div className="stat-card">
    <div className="stat-icon"><Icon size={20} /></div>
    <span>{label}</span><strong>{value}</strong><small>{note}</small>
  </div>;
}

function AIParser({ data, save, activeStore, notify, setPreview, apiKey, setPage }) {
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [parsed, setParsed] = useState(null);
  const inputRef = useRef();

  const handleAddFiles = (incoming) => {
    const arr = Array.from(incoming || []);
    if (!arr.length) return;
    setErrorText("");
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => `${f.name}-${f.size}`));
      const newFiles = arr.filter(f => !existingNames.has(`${f.name}-${f.size}`));
      return [...prev, ...newFiles];
    });
  };

  const removeFile = (index, e) => {
    e.stopPropagation();
    setFiles(prev => prev.filter((_, i) => i !== index));
    if (files.length <= 1) {
      setParsed(null);
      setErrorText("");
    }
  };

  const handleLoadSampleInvoice = () => {
    const sample = {
      vendor: "Core-Mark Distributors",
      invoiceNumber: "INV-99482",
      invoiceDate: new Date().toISOString().slice(0, 10),
      subtotal: 48.95,
      tax: 3.92,
      total: 52.87,
      items: [
        {
          upc: "049000050103",
          description: "Coca-Cola 20oz Bottle 24ct",
          category: "Beverages",
          quantity: 2,
          unitPrice: 1.85,
          srp: 2.49,
          lineTotal: 44.40
        },
        {
          upc: "028400090896",
          description: "Lay's Classic Potato Chips 2.65oz",
          category: "Candy & Snacks",
          quantity: 1,
          unitPrice: 1.95,
          srp: 2.69,
          lineTotal: 23.40
        },
        {
          upc: "012000001017",
          description: "Pepsi Wild Cherry 20oz",
          category: "Beverages",
          quantity: 1,
          unitPrice: 1.85,
          srp: 2.49,
          lineTotal: 22.20
        }
      ]
    };
    sample.items = matchPriceBook(sample.items, activeStore?.products || []);
    setParsed(sample);
    setErrorText("");
    notify("Loaded sample invoice data.");
  };

  const parse = async () => {
    if (!files.length) return notify("Choose one or more invoice images or PDFs first.");
    if (!apiKey) {
      notify("Gemini API key is required. Please set your API Key in Settings.");
      if (setPage) setPage("Settings");
      return;
    }
    setLoading(true);
    setStatusText("Optimizing image(s)...");
    setErrorText("");
    try {
      const result = await parseInvoiceDirectWithGemini(
        apiKey,
        files,
        activeStore?.products || [],
        (msg) => setStatusText(msg)
      );
      setParsed(result);
      notify(`Invoice parsed (${files.length} page${files.length > 1 ? "s" : ""}).`);
    } catch (e) {
      setErrorText(e.message || "Failed to parse invoice with Gemini AI.");
      if (e.message && e.message.includes("GEMINI_API_KEY")) {
        notify("Gemini API key is required. Please set it in Settings.");
        if (setPage) setPage("Settings");
      } else {
        notify(e.message);
      }
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  const saveInvoice = () => {
    if (!parsed) return;
    const inv = {
      id: parsed.invoiceNumber || `INV-${Date.now().toString().slice(-5)}`,
      vendor: parsed.vendor || "Unknown Vendor",
      date: parsed.invoiceDate || new Date().toISOString().slice(0, 10),
      total: Number(parsed.total || 0),
      status: "Pending",
      storeId: activeStore?.id,
      items: parsed.items?.length || 0,
      detail: parsed
    };
    save({ ...data, invoices: [inv, ...data.invoices] });
    notify("Invoice saved to ledger.");
    setPreview(inv);
  };

  return <div className="parser-layout">
    <div className="panel upload-panel">
      <div className="panel-title"><div><h3>AI Invoice Scanner</h3><p>Upload multi-page invoice photos or PDFs for Gemini multi-image extraction.</p></div><div className="ai-badge"><Sparkles size={15} /> Gemini</div></div>
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleAddFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud size={38} />
        {!files.length ? (
          <>
            <h3>Drop invoice page(s) or photos here</h3>
            <p>PDF, PNG, JPG or WEBP (multiple files allowed)</p>
            <button className="secondary" type="button">Browse files</button>
          </>
        ) : (
          <>
            <h3>{files.length} invoice page{files.length > 1 ? "s" : ""} selected</h3>
            <div className="files-preview-list">
              {files.map((f, i) => (
                <div key={i} className="file-chip">
                  <span>{f.name}</span>
                  <button type="button" onClick={(e) => removeFile(i, e)}><X size={13} /></button>
                </div>
              ))}
            </div>
            <button className="secondary" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>+ Add more pages</button>
          </>
        )}
        <input ref={inputRef} type="file" accept=".pdf,image/*" multiple hidden onChange={e => { handleAddFiles(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="parser-actions">
        <div><Building2 size={17} /><span>Compare against <b>{activeStore?.name}</b></span></div>
        <button className="primary" onClick={parse} disabled={loading || !files.length}>{loading ? (statusText || `Scanning ${files.length} page(s)…`) : `Scan ${files.length ? files.length : ""} Page(s) with Gemini`}</button>
      </div>
    </div>

    <div className="panel result-panel">
      {loading ? (
        <div className="empty">
          <Loader2 size={36} className="spin-icon" style={{ color: "#a78bfa" }} />
          <h3>AI Invoice Extraction in Progress...</h3>
          <p>{statusText || "Analyzing vendor, invoice date, line items, and pricing..."}</p>
        </div>
      ) : errorText ? (
        <div className="empty">
          <AlertCircle size={36} style={{ color: "#ef4444" }} />
          <h3 style={{ color: "#ef4444" }}>Invoice Scan Failed</h3>
          <p style={{ color: "#94a3b8", maxWidth: 400, textAlign: "center" }}>{errorText}</p>
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            {!apiKey ? (
              <button className="primary" onClick={() => setPage && setPage("Settings")}>
                Configure Gemini Key in Settings
              </button>
            ) : (
              <button className="secondary" onClick={parse}>
                Try Scan Again
              </button>
            )}
            <button className="ghost" onClick={handleLoadSampleInvoice}>
              Use Sample Data
            </button>
          </div>
        </div>
      ) : !parsed ? (
        <div className="empty">
          <Sparkles size={34} />
          <h3>AI results appear here</h3>
          <p>Koko will extract vendor details, line items across all pages, UPCs, cost, SRP and price differences.</p>
          <button type="button" className="secondary" style={{ marginTop: 16 }} onClick={handleLoadSampleInvoice}>
            ⚡ Try Sample Invoice Data
          </button>
        </div>
      ) : (
        <>
          <div className="panel-title">
            <div><h3>{parsed.vendor || "Parsed Invoice"}</h3><p>{parsed.invoiceNumber || "No invoice number"} · {parsed.invoiceDate || "Date unavailable"}</p></div>
            <div className="result-total"><span>Total</span><strong>{money(parsed.total)}</strong></div>
          </div>
          <div className="table-wrap result-table">
            <table>
              <thead><tr><th>UPC</th><th>Description</th><th>Category</th><th>Cost</th><th>POS</th><th>Diff</th></tr></thead>
              <tbody>{(parsed.items || []).map((item, i) => {
                const isMatched = item.matchedRetail != null;
                const diff = Number(item.priceDifference || 0);
                return <tr key={i} className={!isMatched ? "not-in-pricebook" : ""}>
                  <td className="mono">{item.upc || "—"}</td><td><b>{item.description || "Unknown"}</b></td><td>{item.category || "Misc"}</td>
                  <td>{money(item.unitPrice)}</td><td>{isMatched ? money(item.matchedRetail) : <span className="unmatched-badge">Not in Price Book</span>}</td>
                  <td className={diff > 0 ? "negative" : diff < 0 ? "positive" : ""}>{diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${money(diff)}`}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
          <div className="save-bar"><span>{parsed.items?.length || 0} line items extracted</span><button className="primary" onClick={saveInvoice}>Save invoice</button></div>
        </>
      )}
    </div>
  </div>;
}

function PriceBooks({ data, save, activeStore, activeStoreId, setActiveStoreId, notify }) {
  const [query, setQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreLocation, setNewStoreLocation] = useState("");

  const [editStoreName, setEditStoreName] = useState("");
  const [editStoreLocation, setEditStoreLocation] = useState("");

  const fileRef = useRef();

  const handleOpenAddModal = () => {
    setNewStoreName(`Price Book #${data.stores.length + 1}`);
    setNewStoreLocation("Main Location");
    setShowAddModal(true);
  };

  const handleCreateStore = (e) => {
    e?.preventDefault();
    if (!newStoreName.trim()) return;
    const s = {
      id: uid(),
      name: newStoreName.trim(),
      location: newStoreLocation.trim() || "Main Location",
      products: []
    };
    save({ ...data, stores: [...data.stores, s] });
    setActiveStoreId(s.id);
    setShowAddModal(false);
    notify(`Created price book "${s.name}".`);
  };

  const handleOpenEditModal = () => {
    if (!activeStore) return;
    setEditStoreName(activeStore.name);
    setEditStoreLocation(activeStore.location || "");
    setShowEditModal(true);
  };

  const handleSaveEditStore = (e) => {
    e?.preventDefault();
    if (!editStoreName.trim() || !activeStore) return;
    const updatedName = editStoreName.trim();
    const updatedLocation = editStoreLocation.trim() || "Main Location";
    const stores = data.stores.map(s => s.id === activeStore.id ? { ...s, name: updatedName, location: updatedLocation } : s);
    save({ ...data, stores });
    setShowEditModal(false);
    notify(`Renamed price book to "${updatedName}".`);
  };

  const importCsv = (file) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: ({ data: rawRows }) => {
        if (!rawRows || !rawRows.length) return notify("CSV file was empty.");

        // Detect if first row is a header row
        const firstRow = rawRows[0] || [];
        const isHeader = firstRow.some(cell => {
          const s = String(cell).toLowerCase();
          return s.includes("upc") || s.includes("name") || s.includes("dept") || s.includes("department") || s.includes("retail") || s.includes("price") || s.includes("pos") || s.includes("plu") || s.includes("item");
        });

        const rows = isHeader ? rawRows.slice(1) : rawRows;

        const products = rows.map(r => {
          if (Array.isArray(r)) {
            // Column B (1) = Name, Column C (2) = UPC/PLU, Column E (4) = Department, Column G (6) = Retail Price (POS)
            const name = String(r[1] ?? r[0] ?? "Unnamed item").trim();
            const upc = String(r[2] ?? r[0] ?? "").trim();
            const department = String(r[4] ?? "Miscellaneous").trim() || "Miscellaneous";

            let rawPrice = r[6];
            if (rawPrice == null || rawPrice === "") {
              for (let i = r.length - 1; i >= 0; i--) {
                if (i !== 1 && i !== 2 && i !== 4 && r[i] != null && String(r[i]).replace(/[^0-9.]/g, "") !== "") {
                  rawPrice = r[i];
                  break;
                }
              }
            }
            const retail = Number(String(rawPrice || 0).replace(/[^0-9.]/g, "")) || 0;
            return { upc, name, department, retail };
          } else {
            const name = String(r.Name ?? r.name ?? r.Product ?? r.Description ?? r[1] ?? "Unnamed item").trim();
            const upc = String(r["UPC/PLU"] ?? r["UPC / PLU"] ?? r.UPC ?? r.upc ?? r.PLU ?? r.Barcode ?? r.GTIN ?? r[2] ?? "").trim();
            const department = String(r.Department ?? r.department ?? r.Category ?? r[4] ?? "Miscellaneous").trim() || "Miscellaneous";
            const rawPrice = r["Retail Price (POS)"] ?? r["Retail Price"] ?? r["POS Price"] ?? r.Price ?? r.Retail ?? r.SRP ?? r.retail ?? r.POS ?? r[6] ?? 0;
            const retail = Number(String(rawPrice).replace(/[^0-9.]/g, "")) || 0;
            return { upc, name, department, retail };
          }
        }).filter(x => (x.upc && x.upc.match(/\d+/)) || (x.name && x.name !== "Unnamed item"));

        const stores = data.stores.map(s => s.id === activeStoreId ? { ...s, products } : s);
        save({ ...data, stores });
        notify(`Imported ${products.length} products to ${activeStore?.name || "store"}.`);
      }
    });
  };

  const clear = () => {
    if (!activeStore) return;
    save({ ...data, stores: data.stores.map(s => s.id === activeStore.id ? { ...s, products: [] } : s) });
    notify(`Cleared items in ${activeStore.name}.`);
  };

  const deletePriceBook = () => {
    if (data.stores.length <= 1) {
      return notify("You must keep at least one price book.");
    }
    const name = activeStore.name;
    const remaining = data.stores.filter(s => s.id !== activeStore.id);
    save({ ...data, stores: remaining });
    setActiveStoreId(remaining[0].id);
    notify(`Deleted price book "${name}".`);
  };

  const downloadSample = () => {
    const csv = "Item Code,Name,UPC/PLU,Cost,Department,Tax,Retail Price (POS)\n1001,Coca-Cola 20oz,049000050103,1.50,Beverages,Y,2.49\n1002,Lay's Classic 2.65oz,028400090896,1.60,Candy & Snacks,Y,2.69\n1003,Pepsi 20oz,012000001017,1.50,Beverages,Y,2.49\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "koko-pricebook-template.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  const products = (activeStore?.products || []).filter(p => `${p.upc} ${p.name} ${p.department}`.toLowerCase().includes(query.toLowerCase()));

  return <>
    <div className="panel store-switcher">
      <div className="store-tabs">
        {data.stores.map(s => (
          <button
            className={s.id === activeStoreId ? "store-tab active" : "store-tab"}
            key={s.id}
            onClick={() => setActiveStoreId(s.id)}
          >
            <Store size={16} />
            <div>
              <strong>{s.name}</strong>
              <small>{s.products.length} SKUs</small>
            </div>
          </button>
        ))}
        <button className="store-tab add" onClick={handleOpenAddModal}>
          <Plus size={17} /> Add Price Book
        </button>
      </div>
    </div>

    <div className="panel">
      <div className="panel-title">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ margin: 0 }}>{activeStore?.name} Price Book</h3>
            <button className="ghost icon-btn" onClick={handleOpenEditModal} title="Rename Price Book" style={{ width: 28, height: 28 }}>
              <Pencil size={14} />
            </button>
          </div>
          <p>{activeStore?.location} · {activeStore?.products?.length || 0} products</p>
        </div>
        <div className="inline-actions">
          <button className="ghost" onClick={handleOpenEditModal}><Pencil size={15} /> Rename</button>
          <button className="ghost" onClick={downloadSample}><Download size={16} /> Sample CSV</button>
          <button className="secondary" onClick={() => fileRef.current?.click()}><UploadCloud size={16} /> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={e => e.target.files[0] && importCsv(e.target.files[0])} />
          {data.stores.length > 1 && (
            <button className="danger-btn" onClick={deletePriceBook} title="Delete this price book"><Trash2 size={16} /></button>
          )}
        </div>
      </div>
      <div className="searchbar"><Search size={17} /><input placeholder="Search UPC, product or department…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="table-wrap">
        <table><thead><tr><th>UPC / PLU</th><th>Product</th><th>Department</th><th>Retail</th></tr></thead>
          <tbody>{products.map((p, i) => <tr key={`${p.upc}-${i}`}><td className="mono">{p.upc || "—"}</td><td><b>{p.name}</b></td><td>{p.department}</td><td><b>{money(p.retail)}</b></td></tr>)}
            {!products.length && <tr><td colSpan="4"><div className="empty small">No products found. Import a CSV price book.</div></td></tr>}
          </tbody></table>
      </div>
    </div>

    {showAddModal && (
      <Modal title="Create New Price Book" onClose={() => setShowAddModal(false)}>
        <form onSubmit={handleCreateStore} className="form-grid">
          <Field label="Price Book Name">
            <input
              type="text"
              placeholder="e.g. Downtown Grocery, Store #103..."
              value={newStoreName}
              onChange={e => setNewStoreName(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <Field label="Location / Subtitle">
            <input
              type="text"
              placeholder="e.g. Main St, West Branch..."
              value={newStoreLocation}
              onChange={e => setNewStoreLocation(e.target.value)}
            />
          </Field>
          <button type="submit" className="primary span2">Create Price Book</button>
        </form>
      </Modal>
    )}

    {showEditModal && (
      <Modal title="Rename Price Book" onClose={() => setShowEditModal(false)}>
        <form onSubmit={handleSaveEditStore} className="form-grid">
          <Field label="Price Book Name">
            <input
              type="text"
              placeholder="Enter price book name..."
              value={editStoreName}
              onChange={e => setEditStoreName(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <Field label="Location / Subtitle">
            <input
              type="text"
              placeholder="Enter location or branch..."
              value={editStoreLocation}
              onChange={e => setEditStoreLocation(e.target.value)}
            />
          </Field>
          <button type="submit" className="primary span2">Save Name</button>
        </form>
      </Modal>
    )}
  </>;
}

function Invoices({ data, save, setPreview }) {
  const [filter, setFilter] = useState("All");
  const rows = filter === "All" ? data.invoices : data.invoices.filter(i => i.status === filter);
  const setStatus = (id, status) => save({ ...data, invoices: data.invoices.map(i => i.id === id ? { ...i, status } : i) });

  return <div className="panel">
    <div className="panel-title"><div><h3>Invoice Ledger</h3><p>Track vendor invoices and review payment status.</p></div>
      <div className="segmented">{["All", "Paid", "Pending", "Draft"].map(x => <button className={filter === x ? "active" : ""} onClick={() => setFilter(x)} key={x}>{x}</button>)}</div>
    </div>
    <InvoiceTable invoices={rows} onOpen={setPreview} onStatus={setStatus} />
  </div>;
}

function InvoiceTable({ invoices, compact, onOpen, onStatus }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>Invoice</th><th>Vendor</th><th>Date</th><th>Items</th><th>Status</th><th>Total</th>{!compact && <th />}</tr></thead>
    <tbody>{invoices.map(inv => <tr key={inv.id}>
      <td><b className="purple">{inv.id}</b></td><td><b>{inv.vendor}</b></td><td>{inv.date}</td><td>{inv.items || 0}</td>
      <td>{onStatus ? <select className={`status ${inv.status.toLowerCase()}`} value={inv.status} onChange={e => onStatus(inv.id, e.target.value)}><option>Paid</option><option>Pending</option><option>Draft</option></select> : <span className={`status ${inv.status.toLowerCase()}`}>{inv.status}</span>}</td>
      <td><b>{money(inv.total)}</b></td>
      {!compact && <td><button className="icon-btn" onClick={() => onOpen(inv)}><MoreHorizontal size={18} /></button></td>}
    </tr>)}</tbody>
  </table></div>;
}

function Quotes({ data, save }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ client: "", vendor: "", amount: "", date: new Date().toISOString().slice(0, 10) });
  const add = () => { if (!form.vendor) return; save({ ...data, quotes: [{ id: `Q-${Date.now().toString().slice(-4)}`, status: "Open", ...form, amount: Number(form.amount || 0) }, ...data.quotes] }); setShow(false); };
  return <>
    <div className="panel">
      <div className="panel-title"><div><h3>Quotes</h3><p>Track vendor and client pricing proposals.</p></div><button className="primary" onClick={() => setShow(true)}><Plus size={16} /> New quote</button></div>
      <div className="table-wrap"><table><thead><tr><th>Quote</th><th>Client / Store</th><th>Vendor</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
        <tbody>{data.quotes.map(q => <tr key={q.id}><td><b className="purple">{q.id}</b></td><td>{q.client}</td><td><b>{q.vendor}</b></td><td>{q.date}</td><td><span className="status pending">{q.status}</span></td><td><b>{money(q.amount)}</b></td></tr>)}</tbody>
      </table></div>
    </div>
    {show && <Modal title="New quote" onClose={() => setShow(false)}><div className="form-grid">
      <Field label="Client / Store"><input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} /></Field>
      <Field label="Vendor"><input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /></Field>
      <Field label="Amount"><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
      <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
      <button className="primary span2" onClick={add}>Create quote</button>
    </div></Modal>}
  </>;
}

function Tasks({ data, save }) {
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState("Invoice");
  const add = () => { if (!title.trim()) return; save({ ...data, tasks: [{ id: uid(), title: title.trim(), tag, done: false }, ...data.tasks] }); setTitle("") };
  const toggle = id => save({ ...data, tasks: data.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) });
  const del = id => save({ ...data, tasks: data.tasks.filter(t => t.id !== id) });
  return <div className="tasks-page">
    <div className="panel">
      <div className="panel-title"><div><h3>Task Manager</h3><p>Keep invoice, quote and price-book work moving.</p></div></div>
      <div className="new-task"><input placeholder="Add a task…" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} /><select value={tag} onChange={e => setTag(e.target.value)}><option>Invoice</option><option>PriceBook</option><option>Quote</option><option>Client</option></select><button className="primary" onClick={add}><Plus size={16} /> Add</button></div>
      <div className="full-task-list">{data.tasks.map(t => <div className="full-task" key={t.id}><button className="check" onClick={() => toggle(t.id)}>{t.done ? <CheckCircle2 size={21} /> : <CircleDashed size={21} />}</button><div><b className={t.done ? "strike" : ""}>{t.title}</b><span className={`tag ${t.tag.toLowerCase()}`}>{t.tag}</span></div><button className="icon-btn" onClick={() => del(t.id)}><Trash2 size={17} /></button></div>)}</div>
    </div>
  </div>;
}

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "411112", "411211", "122141",
  "114212", "124112", "124211", "411221", "421121", "421211", "212141", "214121", "412121", "111143",
  "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131",
  "211412", "211214", "211232", "211133", "211331", "211431", "2331112"
];

function BarcodeGtin14({ upc }) {
  const digits = String(upc || "").replace(/\D/g, "").padStart(14, "0").slice(-14);
  const codes = [105];
  for (let i = 0; i < digits.length; i += 2) {
    codes.push(parseInt(digits.slice(i, i + 2), 10));
  }
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) {
    checksum += i * codes[i];
  }
  codes.push(checksum % 103);
  codes.push(106);

  const bars = [];
  let x = 10;
  for (const code of codes) {
    const pat = CODE128_PATTERNS[code] || "211232";
    let isBar = true;
    for (let c = 0; c < pat.length; c++) {
      const width = parseInt(pat[c], 10);
      if (isBar) {
        bars.push(<rect key={`${x}-${c}`} x={x} y={0} width={width * 1.3} height={26} fill="black" />);
      }
      x += width * 1.3;
      isBar = !isBar;
    }
  }
  const totalWidth = x + 10;
  return (
    <div className="gtin-barcode">
      <svg viewBox={`0 0 ${totalWidth} 40`} width="100%" height="38" xmlns="http://www.w3.org/2000/svg">
        {bars}
        <text x={totalWidth / 2} y={38} fontSize="9.5" fontFamily="monospace" textAnchor="middle" fill="#111827">
          GTIN-14: {digits}
        </text>
      </svg>
    </div>
  );
}

function InvoicePreview({ invoice, stores = [], activeStore, onClose }) {
  const detail = invoice.detail || {};
  const storeId = invoice.storeId || activeStore?.id;
  const targetStore = (stores || []).find(s => s.id === storeId) || activeStore || (stores || [])[0];
  const storeProducts = targetStore?.products || [];
  const items = matchPriceBook(detail.items || [], storeProducts);

  return <div className="modal-backdrop">
    <div className="preview-modal">
      <div className="preview-toolbar"><div><b>Koko Invoice Preview</b><span>{invoice.id}</span></div><div><button className="ghost" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button><button className="icon-btn" onClick={onClose}><X size={18} /></button></div></div>
      <div className="print-sheet">
        <div className="invoice-head"><div><img src="/logo.png" alt="Koko Logo" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 8 }} /><h2>Koko Invoice</h2></div><div><span>INVOICE</span><strong>{invoice.id}</strong></div></div>
        <div className="invoice-meta"><div><small>VENDOR</small><b>{invoice.vendor}</b></div><div><small>DATE</small><b>{invoice.date}</b></div><div><small>STATUS</small><b>{invoice.status}</b></div><div><small>TOTAL</small><b>{money(invoice.total)}</b></div></div>
        {items.length ? <table className="print-table"><thead><tr><th>UPC</th><th>Description</th><th>Qty</th><th>SRP</th><th>POS</th><th>L/P</th></tr></thead><tbody>{items.map((it, i) => {
          const srpVal = Number(it.srp || (it.unitPrice ? (it.unitPrice / 0.8) : 0));
          const isMatched = it.matchedRetail != null;
          const posVal = isMatched ? Number(it.matchedRetail) : null;
          const lpVal = posVal == null ? null : Number((posVal - srpVal).toFixed(2));
          let lpColor = "#000000";
          if (lpVal !== null && lpVal !== 0) {
            if (lpVal < 0) lpColor = "#dc2626";
            else if (lpVal > 0) lpColor = "#16a34a";
          }
          return <tr key={i} className={!isMatched ? "not-in-pricebook" : ""}>
            <td>{it.upc || "—"}</td>
            <td>{it.description}</td>
            <td>{it.quantity || 1}</td>
            <td>{money(srpVal)}</td>
            <td>{isMatched ? money(posVal) : <span style={{ color: "#a16207", fontWeight: 600, fontSize: "11px" }}>Not in Price Book</span>}</td>
            <td style={{ color: lpColor, fontWeight: lpVal !== 0 ? 600 : 400 }}>{lpVal == null ? "—" : money(lpVal)}</td>
          </tr>;
        })}</tbody></table> : <div className="empty small">Detailed line items were not stored for this sample invoice.</div>}
        <div className="invoice-total"><span>Invoice Total</span><strong>{money(invoice.total)}</strong></div>
      </div>

      {items.length ? (
        <div className="print-sheet page-break">
          <div className="tags-header">
            <div>
              <h2>Price Cards</h2>
              <span>Generated from Invoice {invoice.id} ({items.length} items)</span>
            </div>
            <img src="/logo.png" alt="Koko Logo" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 6 }} />
          </div>
          <div className="tags-grid">
            {items.map((it, i) => {
              const srpVal = Number(it.srp || (it.unitPrice ? (it.unitPrice / 0.8) : 0));
              const isMatched = it.matchedRetail != null;
              const posVal = isMatched ? Number(it.matchedRetail) : null;
              const lpVal = posVal == null ? null : Number((posVal - srpVal).toFixed(2));
              let lpColor = "#000000";
              if (lpVal !== null && lpVal !== 0) {
                if (lpVal < 0) lpColor = "#dc2626";
                else if (lpVal > 0) lpColor = "#16a34a";
              }
              return (
                <div className="shelf-tag" key={i}>
                  <div className="tag-header">
                    <span className="tag-brand">KOKO RETAIL</span>
                    <span className="tag-cat">{it.category || "General"}</span>
                  </div>
                  <div className="tag-title">{it.description || "Unnamed Item"}</div>
                  <BarcodeGtin14 upc={it.upc} />
                  <div className="tag-prices">
                    <div className="tag-price-block">
                      <small>POS</small>
                      <strong>{isMatched ? money(posVal) : "—"}</strong>
                    </div>
                    <div className="tag-price-block">
                      <small>SRP</small>
                      <span>{money(srpVal)}</span>
                    </div>
                    <div className="tag-price-block">
                      <small>L/P</small>
                      <span style={{ color: lpColor, fontWeight: 700 }}>
                        {lpVal == null ? "—" : money(lpVal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  </div>;
}

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-title"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label> }

createRoot(document.getElementById("root")).render(<App />);
