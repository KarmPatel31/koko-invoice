import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import Papa from "papaparse";
import {
  LayoutDashboard, Store, ReceiptText, FileText, CheckSquare, UploadCloud,
  Search, Plus, Trash2, Download, Printer, ChevronDown, Sparkles, X,
  ArrowUpRight, ArrowDownRight, PackageSearch, CircleDollarSign, Building2,
  MoreHorizontal, CheckCircle2, Clock3, CircleDashed, Key, Settings, LogOut,
  User, Lock, Mail, Eye, EyeOff, Check, AlertCircle, ShieldCheck, Pencil, Loader2,
  Share2, RefreshCw, Zap, ArrowRight, Play, Calculator, BarChart3, Layers, ChevronRight
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line
} from "recharts";
import "./styles.css";
import "./landing.css";
import MarketingLanding from "./components/LandingPage.jsx";
import { createInvoicePdf } from "./services/pdfExport.js";
import { auth, setWorkspaceSession } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import {
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

const uid = () => crypto.randomUUID();
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
      isPartialMatch: false,
      matchType: "none",
      priceDifference: 0
    }));
  }

  const byUpc = new Map();
  const byName = new Map();
  const normalizedProducts = [];

  for (const p of products) {
    const k = normalizeUpc(p.upc);
    if (k) byUpc.set(k, p);
    const n = cleanStr(p.name);
    if (n) byName.set(n, p);
    normalizedProducts.push({ prod: p, normUpc: k, normName: n });
  }

  return (items || []).map(item => {
    let p = null;
    let matchType = "none";
    const itemUpcClean = normalizeUpc(item.upc);

    // 1. Direct Exact Normalized UPC match (handles GTIN-14 vs UPC-A vs EAN-13 leading zeros)
    if (itemUpcClean && byUpc.has(itemUpcClean)) {
      p = byUpc.get(itemUpcClean);
      matchType = "exact";
    }

    // 2. Partial 5-digit UPC suffix match if exact match fails
    if (!p && itemUpcClean && itemUpcClean.length >= 5) {
      const suffix5 = itemUpcClean.slice(-5);
      for (const { prod, normUpc } of normalizedProducts) {
        if (normUpc && normUpc.length >= 5 && normUpc.slice(-5) === suffix5) {
          p = prod;
          matchType = "partial";
          break;
        }
      }
    }

    // 3. Exact Description / Product Name match
    if (!p && (item.description || item.name)) {
      const itemDescClean = cleanStr(item.description || item.name);
      if (itemDescClean) {
        if (byName.has(itemDescClean)) {
          p = byName.get(itemDescClean);
          matchType = "exact";
        } else {
          for (const { prod, normName } of normalizedProducts) {
            if (normName && normName.length >= 6 && itemDescClean === normName) {
              p = prod;
              matchType = "exact";
              break;
            }
          }
        }
      }
    }

    const matchedRetail = p ? Number(p.retail || 0) : null;
    const invoiceSrp = Number(item.srp || 0);
    const comparisonBase = invoiceSrp || Number(item.unitPrice || 0);

    const department = (p && p.department) ? p.department : (item.category || item.department || "General");

    return {
      ...item,
      category: department,
      department: department,
      matchedRetail,
      matchedProduct: p?.name || null,
      isPartialMatch: matchType === "partial",
      matchType,
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

async function parseInvoiceViaServer(files, storeProducts, onStatus) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Sign in to scan invoices. Demo users can use sample data.");
  if (files.length > 5) throw new Error("Upload at most 5 files.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) throw new Error("Uploads must total 20 MB or less.");
  const body = new FormData();
  files.forEach(file => body.append("files", file));
  onStatus?.("Extracting invoice items…");
  const token = await currentUser.getIdToken();
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ""}/api/parse-invoice`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body,
    signal: AbortSignal.timeout(75000)
  });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Invoice scanning is not available yet. Please contact your workspace administrator.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Invoice processing failed.");
  if (auth.currentUser?.uid !== currentUser.uid) throw new Error("Session changed. Please scan again.");
  result.items = matchPriceBook(result.items || [], storeProducts);
  return result;
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
      id: "INV-1048", vendor: "Core-Mark", date: "2026-09-01", total: 1847.23, status: "Working", storeId: "s101", items: 4,
      detail: { invoiceNumber: "INV-1048", vendor: "Core-Mark", invoiceDate: "2026-09-01", total: 1847.23, items: sampleSeedItems }
    },
    {
      id: "INV-1047", vendor: "McLane", date: "2026-08-30", total: 963.55, status: "Done", storeId: "s101", items: 4,
      detail: { invoiceNumber: "INV-1047", vendor: "McLane", invoiceDate: "2026-08-30", total: 963.55, items: sampleSeedItems }
    },
    {
      id: "INV-1046", vendor: "Great Lakes Beverage", date: "2026-08-28", total: 2211.08, status: "Done", storeId: "s102", items: 4,
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

const demoInvoiceItems = [
  { id: 1, upc: "704361150243", itemCode: "95090", description: "GL MIDWEST IPA 4/6C", category: "Beer", quantity: 1, unitPrice: 10.99, srp: 38.38, posPrice: 38.38, lineTotal: 35.18, matchType: "exact", topPct: 3 },
  { id: 2, upc: "704361888122", itemCode: "95258", description: "GL OKTOBERFEST 2/12C", category: "Beer", quantity: 1, unitPrice: 18.99, srp: 30.39, posPrice: 30.39, lineTotal: 30.39, matchType: "exact", topPct: 7 },
  { id: 3, upc: "704361990245", itemCode: "95044", description: "GL OKTOBERFEST 4/6B", category: "Beer", quantity: 1, unitPrice: 10.99, srp: 38.38, posPrice: 38.38, lineTotal: 35.18, matchType: "exact", topPct: 11 },
  { id: 4, upc: "083820123685", itemCode: "66015", description: "GUINNESS PUB 3/8 CAN 14.9OZ", category: "Beer", quantity: 0, unitPrice: 18.99, srp: 45.58, posPrice: 45.58, lineTotal: 0.00, matchType: "danger", note: "WHSE MISPICK", topPct: 15 },
  { id: 5, upc: "083820123685", itemCode: "66015", description: "GUINNESS PUB 3/8 CAN 14.9OZ", category: "Beer", quantity: 0, unitPrice: 18.99, srp: 45.58, posPrice: 45.58, lineTotal: 0.00, matchType: "danger", note: "WHSE MISPICK", topPct: 19 },
  { id: 6, upc: "083820123937", itemCode: "66017", description: "GUINNESS STOUT 4/6 11.2 OZ NR", category: "Beer", quantity: 0, unitPrice: 10.99, srp: 35.18, posPrice: 35.18, lineTotal: 0.00, matchType: "danger", note: "WHSE MISPICK", topPct: 23 },
  { id: 7, upc: "850031116207", itemCode: "26624", description: "HAVE A DAY 12 OZ MIAMI VICE 3/8C", category: "Beverages", quantity: 4, unitPrice: 19.99, srp: 52.78, posPrice: 52.78, lineTotal: 191.92, matchType: "exact", topPct: 26 },
  { id: 8, upc: "071990001568", itemCode: "32007", description: "KEYSTONE LIGHT APPLE 2/15 CAN", category: "Beer", quantity: 3, unitPrice: 12.99, srp: 21.59, posPrice: 21.59, lineTotal: 62.37, matchType: "exact", topPct: 30 },
  { id: 9, upc: "689352009611", itemCode: "109330", description: "KIM CRAWFORD 750ML SAUV BLANC NC", category: "Wine", quantity: 3, unitPrice: 16.99, srp: 13.33, posPrice: 13.33, lineTotal: 33.99, matchType: "exact", topPct: 34 },
  { id: 10, upc: "062067051623", itemCode: "40311", description: "LABATT BLUE 24 OZ CAN", category: "Beer", quantity: 0, unitPrice: 2.49, srp: 24.91, posPrice: 24.91, lineTotal: 0.00, matchType: "warning", note: "CUSTOMER REFUSED", topPct: 38 },
  { id: 11, upc: "804467163168", itemCode: "14614", description: "MG FRANK CASTL 4/6 PK CAN", category: "Beer", quantity: 1, unitPrice: 11.99, srp: 38.38, posPrice: 38.38, lineTotal: 38.38, matchType: "exact", topPct: 41 },
  { id: 12, upc: "754527000660", itemCode: "14347", description: "NB VR IPA 4/6 PK CAN", category: "Beer", quantity: 1, unitPrice: 10.99, srp: 35.18, posPrice: 35.18, lineTotal: 35.18, matchType: "exact", topPct: 45 },
  { id: 13, upc: "754527011727", itemCode: "14851", description: "NB VR JU FORCE 4/6 PK CAN", category: "Beer", quantity: 1, unitPrice: 11.99, srp: 38.38, posPrice: 38.38, lineTotal: 38.38, matchType: "exact", topPct: 49 },
  { id: 14, upc: "850005236566", itemCode: "17022", description: "RHINE BUBBLES IMPERI 15-19.2C", category: "Beer", quantity: 2, unitPrice: 2.99, srp: 35.93, posPrice: 35.93, lineTotal: 71.86, matchType: "exact", topPct: 53 },
  { id: 15, upc: "860634000261", itemCode: "17014", description: "RHINE TRUTH 2/12 PK CAN", category: "Beer", quantity: 1, unitPrice: 19.99, srp: 31.99, posPrice: 31.99, lineTotal: 31.99, matchType: "exact", topPct: 57 },
  { id: 16, upc: "082000782506", itemCode: "66055", description: "SMIR ICE RWB 4/6 NR", category: "Beverages", quantity: 1, unitPrice: 10.49, srp: 35.18, posPrice: 35.18, lineTotal: 33.58, matchType: "exact", topPct: 60 },
  { id: 17, upc: "086788000906", itemCode: "113636", description: "SMITH & HOOK 750ML CAB SAUV", category: "Wine", quantity: 1, unitPrice: 19.99, srp: 239.95, posPrice: 239.95, lineTotal: 159.95, matchType: "exact", topPct: 64 },
  { id: 18, upc: "853759000421", itemCode: "11195", description: "ST PUMKING 6/4 PK NR", category: "Beer", quantity: 2, unitPrice: 14.99, srp: 76.77, posPrice: 76.77, lineTotal: 143.94, matchType: "exact", topPct: 68 },
  { id: 19, upc: "087692024132", itemCode: "26608", description: "SUN CRUISER-CS 12 OZ BLUEBERR 3/8 CN", category: "Beverages", quantity: 1, unitPrice: 17.99, srp: 64.78, posPrice: 64.78, lineTotal: 43.18, matchType: "exact", topPct: 72 },
  { id: 20, upc: "087692024040", itemCode: "26591", description: "SUN CRUISER-CS 570ML CLASSIC TEA CN", category: "Beverages", quantity: 1, unitPrice: 3.49, srp: 31.53, posPrice: 31.53, lineTotal: 31.53, matchType: "exact", topPct: 76 },
  { id: 21, upc: "087692021544", itemCode: "26282", description: "SUN CRUISER-CS 120Z LEMONAD VP3/8CN", category: "Beverages", quantity: 2, unitPrice: 17.99, srp: 64.78, posPrice: 64.78, lineTotal: 86.36, matchType: "exact", topPct: 79 },
  { id: 22, upc: "087692024415", itemCode: "26565", description: "SUN CRUISER-CS 120Z SAMPLER 2/12C", category: "Beverages", quantity: 1, unitPrice: 26.99, srp: 63.99, posPrice: 63.99, lineTotal: 40.50, matchType: "exact", topPct: 83 },
  { id: 23, upc: "087692022510", itemCode: "26561", description: "SUN CRUISER-CS 120Z TEA VAR 2/12C", category: "Beverages", quantity: 2, unitPrice: 26.99, srp: 63.99, posPrice: 63.99, lineTotal: 81.00, matchType: "exact", topPct: 87 },
  { id: 24, upc: "085200000623", itemCode: "106028", description: "SUTTER GLASS 1.5 L MOSCATO", category: "Wine", quantity: 2, unitPrice: 11.99, srp: 10.67, posPrice: 10.67, lineTotal: 16.00, matchType: "warning", note: "MARGIN CHECK", topPct: 90 },
  { id: 25, upc: "085200000685", itemCode: "105968", description: "SUTTER GLASS 1.5 L PINOT GRIGIO", category: "Wine", quantity: 3, unitPrice: 11.99, srp: 10.67, posPrice: 10.67, lineTotal: 24.00, matchType: "warning", note: "MARGIN CHECK", topPct: 93 },
  { id: 26, upc: "085200718740", itemCode: "26009", description: "SUTTER SMAL-CS 4/PAK SAUVIGNON BLANC CASE", category: "Wine", quantity: 1, unitPrice: 7.99, srp: 39.97, posPrice: 39.97, lineTotal: 31.97, matchType: "exact", topPct: 96 }
];

const emptyData = () => ({ stores: [], invoices: [], quotes: [], tasks: [] });

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState(emptyData);
  const [page, setPage] = useState("Dashboard");
  const [activeStoreId, setActiveStoreId] = useState("");
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState(null);
  const [firestoreConnected, setFirestoreConnected] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [viewMode, setViewMode] = useState("landing");

  const handleStartDemoSession = () => {
    const demoUser = {
      uid: "user-demo-guest",
      email: "demo@kokoinvoice.com",
      displayName: "Guest Store Admin",
      isDemo: true
    };
    setUser(demoUser);


    // Ensure sample invoice exists in state
    setData(() => {
      const prev = structuredClone(seed);
      const exists = prev.invoices?.some(i => i.id === "INV-DEMO-2026");
      if (exists) return prev;
      const demoInv = {
        id: "INV-DEMO-2026",
        invoiceNumber: "95090-DIST-DEMO",
        invoiceDate: new Date().toISOString().split("T")[0],
        vendor: "Midwest Wholesale Beverage Co.",
        storeId: activeStoreId || prev.stores?.[0]?.id || "s101",
        subtotal: 1178.68,
        tax: 0,
        total: 1178.68,
        status: "Completed",
        createdAt: new Date().toISOString(),
        items: demoInvoiceItems.map(it => ({
          upc: it.upc,
          description: it.description,
          category: it.category,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          srp: it.srp,
          lineTotal: it.lineTotal,
          matchedRetail: it.posPrice,
          isPartialMatch: false,
          matchType: it.matchType === "exact" ? "exact" : "none",
          priceDifference: 0
        }))
      };
      return {
        ...prev,
        invoices: [demoInv, ...(prev.invoices || [])]
      };
    });

    setViewMode("app");
    notify("Demo workspace loaded! Exploring parsed demo invoice.");
  };

  useEffect(() => {
    try { ["koko-auth-user", "koko-gemini-api-key", "koko-invoice-data"].forEach(key => localStorage.removeItem(key)); } catch {}
    return onAuthStateChanged(auth, async fbUser => {
      setWorkspaceSession(null);
      setUser(null);
      setData(emptyData());
      setPreview(null);
      setAuthReady(false);
      let workspace = null;
      if (fbUser) {
        try {
          const token = await fbUser.getIdTokenResult();
          if (auth.currentUser?.uid !== fbUser.uid) return;
          if (token.claims.kokoAccess !== true || !token.claims.companyId || !["owner", "admin", "staff", "viewer"].includes(token.claims.role)) {
            await signOut(auth);
            setToast("This account has not been invited to Koko Invoice.");
            return;
          }
          workspace = { uid: fbUser.uid, companyId: token.claims.companyId, role: token.claims.role };
          setWorkspaceSession(workspace);
        } catch { await signOut(auth); return; }
      }
      setUser(fbUser ? { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName, ...workspace } : null);
      setData(emptyData());
      setPreview(null);
      setPage("Dashboard");
      setActiveStoreId("");
      setFirestoreConnected(false);
      setSyncError("");
      setViewMode(fbUser ? "app" : "landing");
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!user || user.isDemo) return;
    let active = true;
    const unsubscribe = subscribeToFirestore(user.companyId, cloudData => {
      if (!active || auth.currentUser?.uid !== user.uid) return;
      setData(cloudData);
      setActiveStoreId(current => cloudData.stores.some(store => store.id === current) ? current : cloudData.stores[0]?.id || "");
      setFirestoreConnected(true);
      setSyncError("");
    }, () => { setFirestoreConnected(false); setSyncError("Unable to sync your workspace. Check your connection and reload before editing."); });
    return () => { active = false; unsubscribe(); };
  }, [user?.uid, user?.companyId]);

  const save = async (next) => {
    const prev = data;
    if (user?.isDemo) { setData(next); return true; }
    if (user?.role === "viewer") { notify("Your role has read-only access."); return false; }
    if (!user || auth.currentUser?.uid !== user.uid || !firestoreConnected || syncError) {
      setSyncError("Workspace is not ready. Please wait for your data to load."); return false;
    }
    setData(next);

    try {
      const promises = [];
      if (next.stores) {
        promises.push(...next.stores.filter(item => !prev.stores.some(old => old.id === item.id && JSON.stringify(old) === JSON.stringify(item))).map(s => saveStoreDoc(s)));
        if (prev.stores) {
          const removed = prev.stores.filter(ps => !next.stores.some(ns => ns.id === ps.id));
          promises.push(...removed.map(rs => deleteStoreDoc(rs.id)));
        }
      }
      if (next.invoices) {
        promises.push(...next.invoices.filter(item => !prev.invoices.some(old => old.id === item.id && JSON.stringify(old) === JSON.stringify(item))).map(inv => saveInvoiceDoc(inv)));
        if (prev.invoices) {
          const removed = prev.invoices.filter(pi => !next.invoices.some(ni => ni.id === pi.id));
          promises.push(...removed.map(ri => deleteInvoiceDoc(ri.id)));
        }
      }
      if (next.quotes) {
        promises.push(...next.quotes.filter(item => !prev.quotes.some(old => old.id === item.id && JSON.stringify(old) === JSON.stringify(item))).map(q => saveQuoteDoc(q)));
        if (prev.quotes) {
          const removed = prev.quotes.filter(pq => !next.quotes.some(nq => nq.id === pq.id));
          promises.push(...removed.map(rq => deleteQuoteDoc(rq.id)));
        }
      }
      if (next.tasks) {
        promises.push(...next.tasks.filter(item => !prev.tasks.some(old => old.id === item.id && JSON.stringify(old) === JSON.stringify(item))).map(t => saveTaskDoc(t)));
        if (prev.tasks) {
          const removed = prev.tasks.filter(pt => !next.tasks.some(nt => nt.id === pt.id));
          promises.push(...removed.map(rt => deleteTaskDoc(rt.id)));
        }
      }
      await Promise.all(promises);
      return true;
    } catch (err) {
      console.error("Workspace save failed", err.code);
      if (auth.currentUser?.uid === user.uid) setSyncError("Your changes could not be saved. Reload to recover the saved workspace before editing again.");
      return false;
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      setSyncError("Sign out failed. Please try again.");
      return;
    }
    setUser(null);
    setData(emptyData());
    setPreview(null);
    setPage("Dashboard");
    setViewMode("landing");
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

  if (!authReady) return <MarketingLanding />;

  if (viewMode === "landing") {
    return (
      <LandingPage
        onStartDemo={handleStartDemoSession}
        onLoginSuccess={(u) => {
          setViewMode("app");
          notify(`Welcome back, ${u.displayName || u.email}!`);
        }}
      />
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLogin={(u) => {
          setViewMode("app");
          notify(`Welcome back, ${u.displayName || u.email}!`);
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {user?.isDemo && (
        <div className="demo-mode-strip">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} />
            <span><strong>Interactive Demo Workspace</strong> — Exploring live distributor invoice sample (26 items extracted & matched)</span>
          </div>
          <button onClick={() => setViewMode("landing")}>Return to Landing Page</button>
        </div>
      )}

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

            <button
              className="secondary"
              style={{ width: "100%", marginTop: 10, fontSize: 12, display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }}
              onClick={() => setViewMode("landing")}
            >
              <Layers size={14} /> Back to Landing Page
            </button>

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
              <span className="key-status-text active">
                Server-managed AI
              </span>
            </button>
            <button className="primary" onClick={() => setPage("AI Parser")}><UploadCloud size={17} /> Scan invoice</button>
          </div>
        </header>

        <section className="content">
          {user.role === "viewer" && <p role="status">You have read-only access to this company workspace.</p>}
          {syncError && <div role="alert" className="auth-alert error">{syncError}</div>}
          {page === "Dashboard" && <Dashboard data={data} activeStore={activeStore} save={save} setPage={setPage} />}
          {page === "AI Parser" && <AIParser data={data} save={save} activeStore={activeStore} notify={notify} setPreview={setPreview} setPage={setPage} />}
          {page === "Price Books" && <PriceBooks data={data} save={save} activeStore={activeStore} activeStoreId={activeStoreId} setActiveStoreId={setActiveStoreId} notify={notify} />}
          {page === "Invoices" && <Invoices data={data} save={save} setPreview={setPreview} />}
          {page === "Quotes" && <Quotes data={data} save={save} />}
          {page === "Tasks" && <Tasks data={data} save={save} />}
          {page === "Settings" && <SettingsView user={user} notify={notify} handleLogout={handleLogout} />}
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
      {preview && <InvoicePreview invoice={preview} stores={data.stores} activeStore={activeStore} onClose={() => setPreview(null)} />}
    </div>
  </div>
);
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      const token = await result.user.getIdTokenResult();
      if (token.claims.kokoAccess !== true || !token.claims.companyId || !["owner", "admin", "staff", "viewer"].includes(token.claims.role)) { await signOut(auth); throw new Error(); }
      onLogin?.(result.user);
    } catch { setError("Unable to sign in. Check your email and password, or contact the workspace administrator for access."); }
    finally { setBusy(false); }
  }
  return <div className="login-wrapper"><div className="login-card">
    <h2>Sign in to Koko Invoice</h2>
    <form onSubmit={submit} className="auth-form">
      <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p role="alert">{error}</p>}
      <button className="primary auth-submit-btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <button type="button" className="secondary" disabled={busy || !email.trim()} onClick={async () => {
        setBusy(true);
        try { await sendPasswordResetEmail(auth, email.trim()); } catch {}
        setError("If this email has an account, a password reset email will arrive shortly.");
        setBusy(false);
      }}>Reset password</button>
    </form>
  </div></div>;
}

function LandingPage({ onStartDemo, onLoginSuccess }) {
  const [showLogin, setShowLogin] = useState(false);
  return <><MarketingLanding onStartDemo={onStartDemo} onSignIn={() => setShowLogin(true)} />
    {showLogin && <Modal title="Sign in to your workspace" onClose={() => setShowLogin(false)}>
      <LoginPage onLogin={user => { setShowLogin(false); onLoginSuccess(user); }} />
    </Modal>}
  </>;
}

function SettingsView({ user, handleLogout }) {
  return (
    <div className="settings-page">
      <div className="panel settings-panel"><h3>Invoice scanning</h3><p>AI scanning is managed securely by the server. Sign in to scan your invoices.</p></div>
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
            <span className="label">Company & Role</span>
            <span className="value mono">{user?.companyId || "Demo"} · {user?.role || "Guest"}</span>
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
  const pending = data.invoices.filter(x => x.status === "Working" || x.status === "Pending").length;
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
      <InvoiceTable invoices={data.invoices.slice(0, 5)} stores={data.stores} compact />
    </div>
  </>;
}

function Stat({ icon: Icon, label, value, note }) {
  return <div className="stat-card">
    <div className="stat-icon"><Icon size={20} /></div>
    <span>{label}</span><strong>{value}</strong><small>{note}</small>
  </div>;
}

function AIParser({ data, save, activeStore, notify, setPreview, setPage }) {
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

  useEffect(() => {
    const handlePaste = (e) => {
      const clipboardItems = e.clipboardData?.items || [];
      const imageFiles = [];

      for (const item of clipboardItems) {
        if (item.type && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const ext = item.type.split("/")[1] || "png";
            const pastedFile = new File(
              [file],
              `Pasted Invoice Image ${files.length + imageFiles.length + 1}.${ext}`,
              { type: item.type, lastModified: Date.now() }
            );
            imageFiles.push(pastedFile);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        handleAddFiles(imageFiles);
        notify(`Pasted ${imageFiles.length} image(s) from clipboard.`);
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [files.length, notify]);

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
    setLoading(true);
    setStatusText("Optimizing image(s)...");
    setErrorText("");
    try {
      const result = await parseInvoiceViaServer(
        files,
        activeStore?.products || [],
        (msg) => setStatusText(msg)
      );
      setParsed(result);
      notify(`Invoice parsed (${files.length} page${files.length > 1 ? "s" : ""}).`);
    } catch (e) {
      setErrorText(e.message || "Failed to parse invoice with Gemini AI.");
      notify(e.message);
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  const saveInvoice = async () => {
    if (!parsed) return;
    if (!activeStore) return notify("Create a price book before saving an invoice.");
    const rawId = `${parsed.invoiceNumber || "INV"}-${uid()}`;
    const safeId = rawId.replace(/[/]/g, "-");
    const inv = {
      id: safeId,
      vendor: parsed.vendor || "Unknown Vendor",
      date: parsed.invoiceDate || new Date().toISOString().slice(0, 10),
      total: Number(parsed.total || 0),
      status: "Working",
      storeId: activeStore?.id,
      items: parsed.items?.length || 0,
      detail: parsed
    };
    if (!await save({ ...data, invoices: [inv, ...data.invoices] })) return;
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
            <p>PDF, PNG, JPG, WEBP or Paste Image from Clipboard (Cmd+V / Ctrl+V)</p>
            <button className="secondary" type="button">Browse files or Paste</button>
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
            <button className="secondary" onClick={parse}>Try Scan Again</button>
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
              <thead><tr><th>UPC</th><th>Description</th><th>Cost</th><th>POS</th><th>Diff</th></tr></thead>
              <tbody>{(parsed.items || []).map((item, i) => {
                const isMatched = item.matchedRetail != null;
                const isPartial = item.isPartialMatch || item.matchType === "partial";
                const diff = Number(item.priceDifference || 0);
                const rowClass = isPartial ? "partial-upc-match" : !isMatched ? "not-in-pricebook" : "";
                return <tr key={i} className={rowClass}>
                  <td className="mono">{item.upc || "—"}</td><td><b>{item.description || "Unknown"}</b></td>
                  <td>{money(item.unitPrice)}</td><td>{isMatched ? money(item.matchedRetail) : "—"}</td>
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
  const replaceFileRef = useRef();

  const handleOpenAddModal = () => {
    setNewStoreName(`Price Book #${data.stores.length + 1}`);
    setNewStoreLocation("Main Location");
    setShowAddModal(true);
  };

  const handleCreateStore = async (e) => {
    e?.preventDefault();
    if (!newStoreName.trim()) return;
    const s = {
      id: uid(),
      name: newStoreName.trim(),
      location: newStoreLocation.trim() || "Main Location",
      products: []
    };
    if (!await save({ ...data, stores: [...data.stores, s] })) return;
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

  const handleSaveEditStore = async (e) => {
    e?.preventDefault();
    if (!editStoreName.trim() || !activeStore) return;
    const updatedName = editStoreName.trim();
    const updatedLocation = editStoreLocation.trim() || "Main Location";
    const stores = data.stores.map(s => s.id === activeStore.id ? { ...s, name: updatedName, location: updatedLocation } : s);
    if (!await save({ ...data, stores })) return;
    setShowEditModal(false);
    notify(`Renamed price book to "${updatedName}".`);
  };

  const parseCsvProducts = (rawRows) => {
    const firstRow = rawRows[0] || [];
    const isHeader = firstRow.some(cell => {
      const s = String(cell).toLowerCase();
      return s.includes("upc") || s.includes("name") || s.includes("dept") || s.includes("department") || s.includes("retail") || s.includes("price") || s.includes("pos") || s.includes("plu") || s.includes("item");
    });

    const rows = isHeader ? rawRows.slice(1) : rawRows;

    return rows.map(r => {
      if (Array.isArray(r)) {
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
  };

  const handleReplaceCsv = (file) => {
    if (!file || !activeStore) return;
    if (file.size > 10 * 1024 * 1024) return notify("CSV files must be 10 MB or smaller.");
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async ({ data: rawRows }) => {
        if (!rawRows || !rawRows.length) return notify("CSV file was empty.");
        const products = parseCsvProducts(rawRows);
        const stores = data.stores.map(s => s.id === activeStoreId ? { ...s, products } : s);
        if (!await save({ ...data, stores })) return;
        notify(`Replaced price book for "${activeStore.name}" with ${products.length} latest products.`);
      }
    });
  };

  const importCsv = (file) => {
    if (!file || !activeStore) return notify("Create a price book first.");
    if (file.size > 10 * 1024 * 1024) return notify("CSV files must be 10 MB or smaller.");
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async ({ data: rawRows }) => {
        if (!rawRows || !rawRows.length) return notify("CSV file was empty.");
        const products = parseCsvProducts(rawRows);
        const stores = data.stores.map(s => s.id === activeStoreId ? { ...s, products: [...(s.products || []), ...products] } : s);
        if (!await save({ ...data, stores })) return;
        notify(`Added ${products.length} products to ${activeStore?.name || "store"}.`);
      }
    });
  };

  const clear = async () => {
    if (!activeStore) return;
    if (!await save({ ...data, stores: data.stores.map(s => s.id === activeStore.id ? { ...s, products: [] } : s) })) return;
    notify(`Cleared items in ${activeStore.name}.`);
  };

  const deletePriceBook = async () => {
    if (data.stores.length <= 1) {
      return notify("You must keep at least one price book.");
    }
    const name = activeStore.name;
    const remaining = data.stores.filter(s => s.id !== activeStore.id);
    if (!await save({ ...data, stores: remaining })) return;
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
          <button className="primary" onClick={() => replaceFileRef.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <RefreshCw size={15} /> Replace Price Book
          </button>
          <input ref={replaceFileRef} type="file" accept=".csv" hidden onChange={e => { if (e.target.files[0]) { handleReplaceCsv(e.target.files[0]); e.target.value = ""; } }} />

          <button className="ghost" onClick={handleOpenEditModal}><Pencil size={15} /> Rename</button>
          <button className="ghost" onClick={downloadSample}><Download size={16} /> Sample CSV</button>
          <button className="secondary" onClick={() => fileRef.current?.click()}><UploadCloud size={16} /> Import / Append CSV</button>
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={e => { if (e.target.files[0]) { importCsv(e.target.files[0]); e.target.value = ""; } }} />
          {data.stores.length > 1 && (
            <button className="danger-btn" onClick={deletePriceBook} title="Delete this price book"><Trash2 size={16} /></button>
          )}
        </div>
      </div>
      <div className="searchbar"><Search size={17} /><input placeholder="Search UPC, product or department…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="table-wrap">
        <table><thead><tr><th>UPC / PLU</th><th>Product</th><th>Department</th><th>Retail</th></tr></thead>
          <tbody>{products.map((p, i) => <tr key={`${p.upc}-${i}`}><td className="mono">{p.upc || "—"}</td><td><b>{p.name}</b></td><td>{p.department}</td><td><b>{money(p.retail)}</b></td></tr>)}
            {!products.length && <tr><td colSpan="4"><div className="empty small">No products found. Import or replace CSV price book.</div></td></tr>}
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
      <Modal title="Manage Price Book" onClose={() => setShowEditModal(false)}>
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
          <Field label="Replace with Newest CSV Catalog" className="span2">
            <button type="button" className="secondary" style={{ width: "100%", justifyContent: "center" }} onClick={() => { setShowEditModal(false); replaceFileRef.current?.click(); }}>
              <RefreshCw size={15} /> Upload & Replace with Latest CSV
            </button>
          </Field>
          <button type="submit" className="primary span2">Save Details</button>
        </form>
      </Modal>
    )}
  </>;
}

function Invoices({ data, save, setPreview }) {
  const [filter, setFilter] = useState("All");
  const [selectedStoreId, setSelectedStoreId] = useState("All");

  const rows = (data.invoices || []).filter(i => {
    const matchesStatus = filter === "All" || i.status === filter;
    const invStoreId = i.storeId || data.stores?.[0]?.id;
    const matchesStore = selectedStoreId === "All" || invStoreId === selectedStoreId;
    return matchesStatus && matchesStore;
  });

  const setStatus = (id, status) => save({ ...data, invoices: data.invoices.map(i => i.id === id ? { ...i, status } : i) });

  return <div className="panel">
    <div className="panel-title">
      <div>
        <h3>Invoice Ledger</h3>
        <p>Track vendor invoices and filter by store price book.</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Store size={15} style={{ color: "#a78bfa" }} />
          <select
            value={selectedStoreId}
            onChange={e => setSelectedStoreId(e.target.value)}
            style={{ background: "#0c111c", color: "#e9edf5", border: "1px solid #252d3f", padding: "6px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            <option value="All">All Price Books ({data.stores?.length || 0})</option>
            {(data.stores || []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="segmented">
          {["All", "Working", "Done"].map(x => <button className={filter === x ? "active" : ""} onClick={() => setFilter(x)} key={x}>{x}</button>)}
        </div>
      </div>
    </div>
    <InvoiceTable invoices={rows} stores={data.stores} onOpen={setPreview} onStatus={setStatus} />
  </div>;
}

function InvoiceTable({ invoices, stores = [], compact, onOpen, onStatus }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>Invoice</th><th>Vendor</th><th>Date</th><th>Price Book</th><th>Items</th><th>Status</th><th>Total</th>{!compact && <th />}</tr></thead>
    <tbody>{invoices.map(inv => {
      const targetStore = (stores || []).find(s => s.id === inv.storeId) || (stores || [])[0];
      const storeName = targetStore?.name || "Price Book";
      return <tr key={inv.id}>
        <td><b className="purple">{inv.id}</b></td>
        <td><b>{inv.vendor}</b></td>
        <td>{inv.date}</td>
        <td><span className="tag pricebook" style={{ fontSize: "10px", fontWeight: 600 }}>{storeName}</span></td>
        <td>{Array.isArray(inv.items) ? inv.items.length : inv.items || 0}</td>
        <td>{onStatus ? <select className={`status ${inv.status.toLowerCase()}`} value={inv.status} onChange={e => onStatus(inv.id, e.target.value)}><option>Working</option><option>Done</option></select> : <span className={`status ${inv.status.toLowerCase()}`}>{inv.status}</span>}</td>
        <td><b>{money(inv.total)}</b></td>
        {!compact && <td><button className="icon-btn" onClick={() => onOpen(inv)}><MoreHorizontal size={18} /></button></td>}
      </tr>;
    })}</tbody>
  </table></div>;
}

function Quotes({ data, save }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ client: "", vendor: "", amount: "", date: new Date().toISOString().slice(0, 10) });
  const add = () => { if (!form.vendor) return; save({ ...data, quotes: [{ id: `Q-${uid()}`, status: "Open", ...form, amount: Number(form.amount || 0) }, ...data.quotes] }); setShow(false); };
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
  const detail = invoice.detail || (Array.isArray(invoice.items) ? { items: invoice.items } : {});
  const storeId = invoice.storeId || activeStore?.id;
  const targetStore = (stores || []).find(s => s.id === storeId) || activeStore || (stores || [])[0];
  const storeProducts = targetStore?.products || [];
  const items = matchPriceBook(detail.items || [], storeProducts);

  const vendorName = invoice?.vendor ? invoice.vendor.trim() : "Unknown Vendor";
  const formattedTitle = `Koko Invoice - ${vendorName}`;
  const printContainerRef = useRef(null);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    const originalTitle = document.title;
    document.title = formattedTitle;
    return () => {
      document.title = originalTitle;
    };
  }, [formattedTitle]);

  const handlePrint = () => {
    document.title = formattedTitle;
    window.print();
  };

  const handleShareWhatsApp = async () => {
    const shareText = `🧾 *Koko Invoice Details*\n` +
      `• *Vendor:* ${invoice.vendor || "Unknown"}\n` +
      `• *Invoice #:* ${invoice.id}\n` +
      `• *Date:* ${invoice.date || "N/A"}\n` +
      `• *Store:* ${targetStore?.name || "Store"}\n` +
      `• *Total:* ${money(invoice.total)}\n` +
      `• *Items:* ${items.length} product(s)\n\n` +
      `Sent via Koko Invoice System`;

    setIsSharing(true);

    try {
      const fileName = `${formattedTitle}.pdf`;
      let pdfFile = null;

      if (printContainerRef.current) {
        const pdfBlob = await createInvoicePdf(printContainerRef.current, fileName);
        pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });
      }

      // 1. Try native Web Share API with attached PDF file (Mobile / Safari)
      if (pdfFile && navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({
            title: formattedTitle,
            text: shareText,
            files: [pdfFile]
          });
          setIsSharing(false);
          return;
        } catch (err) {
          if (err.name === "AbortError") {
            setIsSharing(false);
            return;
          }
          console.log("File share cancelled or unsupported, falling back to download...", err);
        }
      }

      // 2. Desktop / WhatsApp Web Fallback: Download PDF + Open WhatsApp Web with text
      if (pdfFile) {
        const blobUrl = URL.createObjectURL(pdfFile);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }

      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText + "\n\n(📄 PDF Invoice downloaded to your device)")}`;
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");

    } catch (err) {
      console.error("Error generating PDF for share:", err);
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    } finally {
      setIsSharing(false);
    }
  };

  return createPortal(<div className="modal-backdrop invoice-preview-backdrop">
    <div className="preview-modal">
      <div className="preview-toolbar">
        <div><b>Koko Invoice Preview</b><span>{invoice.id}</span></div>
        <div>
          <button className="secondary" onClick={handleShareWhatsApp} disabled={isSharing} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            {isSharing ? <Loader2 size={16} className="spin" /> : <Share2 size={16} style={{ color: "#25D366" }} />}
            {isSharing ? "Generating PDF..." : "Share to WhatsApp"}
          </button>
          <button className="ghost" onClick={handlePrint}><Printer size={16} /> Print / Save PDF</button>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
      </div>

      <div ref={printContainerRef} className="invoice-document">
        <div className="print-sheet">
          <div className="invoice-head"><div><img src="/logo.png" alt="Koko Logo" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 8 }} /><h2>Koko Invoice</h2></div><div><span>INVOICE</span><strong>{invoice.id}</strong></div></div>
          <div className="invoice-meta"><div><small>VENDOR</small><b>{invoice.vendor}</b></div><div><small>DATE</small><b>{invoice.date}</b></div><div><small>STORE</small><b>{targetStore?.name || "Store"}</b></div><div><small>TOTAL</small><b>{money(invoice.total)}</b></div></div>
          {items.length ? <table className="print-table"><colgroup><col style={{ width: "21%" }} /><col style={{ width: "35%" }} /><col style={{ width: "8%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /></colgroup><thead><tr><th>UPC</th><th>Description</th><th>Qty</th><th>SRP</th><th>POS</th><th>L/P</th></tr></thead><tbody>{items.map((it, i) => {
            const srpVal = Number(it.srp || (it.unitPrice ? (it.unitPrice / 0.8) : 0));
            const isMatched = it.matchedRetail != null;
            const isPartial = it.isPartialMatch || it.matchType === "partial";
            const posVal = isMatched ? Number(it.matchedRetail) : null;
            const lpVal = posVal == null ? null : Number((posVal - srpVal).toFixed(2));
            let lpColor = "#000000";
            if (lpVal !== null && lpVal !== 0) {
              if (lpVal < 0) lpColor = "#dc2626";
              else if (lpVal > 0) lpColor = "#16a34a";
            }
            const rowClass = isPartial ? "partial-upc-match" : !isMatched ? "not-in-pricebook" : "";
            return <tr key={i} className={rowClass}>
              <td>{it.upc || "—"}</td>
              <td>{it.description}</td>
              <td>{it.quantity || 1}</td>
              <td>{money(srpVal)}</td>
              <td>{isMatched ? money(posVal) : "—"}</td>
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
              {Array.from({ length: Math.ceil(items.length / 3) }, (_, row) => (
              <div className="tags-row" key={row}>
              {items.slice(row * 3, row * 3 + 3).map((it, i) => {
                const srpVal = Number(it.srp || (it.unitPrice ? (it.unitPrice / 0.8) : 0));
                const isMatched = it.matchedRetail != null;
                const isPartial = it.isPartialMatch || it.matchType === "partial";
                const posVal = isMatched ? Number(it.matchedRetail) : null;
                const lpVal = posVal == null ? null : Number((posVal - srpVal).toFixed(2));
                let lpColor = "#000000";
                if (lpVal !== null && lpVal !== 0) {
                  if (lpVal < 0) lpColor = "#dc2626";
                  else if (lpVal > 0) lpColor = "#16a34a";
                }
                const tagClass = isPartial ? "shelf-tag partial-upc-match" : !isMatched ? "shelf-tag not-in-pricebook" : "shelf-tag";
                return (
                  <div className={tagClass} key={i}>
                    <div className="tag-header">
                      <span className="tag-brand">KOKO RETAIL</span>
                      <span className="tag-cat">{it.category || it.department || "General"}</span>
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
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  </div>, document.body);
}

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-title"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label> }

createRoot(document.getElementById("root")).render(<App />);
