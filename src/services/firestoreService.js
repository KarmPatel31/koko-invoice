import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch
} from "firebase/firestore";
import { db, auth, getWorkspaceSession } from "../firebase.js";

function owner() {
  if (!auth.currentUser) throw new Error("Authentication required");
  return getWorkspaceSession().companyId;
}

const CHUNK_SIZE = 250;

async function loadStoreProducts(data, storeId, userId) {
  if (!data.hasChunks) {
    return data.products || [];
  }
  try {
    const chunksSnap = await getDocs(collection(db, "companies", userId, "stores", storeId, "chunks"));
    const allProducts = [];
    // Sort chunks by ID order
    const docs = chunksSnap.docs.sort((a, b) => a.id.localeCompare(b.id));
    for (const cDoc of docs) {
      const items = cDoc.data().items || [];
      allProducts.push(...items);
    }
    return allProducts;
  } catch (err) {
    console.error(`Error loading product chunks for store ${storeId}:`, err);
    throw err;
  }
}

// Real-time listener for all app collections
export function subscribeToFirestore(userId, onChange, onError) {
  if (owner() !== userId) throw new Error("Session changed");
  let active = true;
  let storeVersion = 0;
  const ready = new Set();
  const fail = error => { if (active) onError?.(error); };
  const emit = () => {
    if (!active || ready.size !== 4) return;
    let session;
    try { session = getWorkspaceSession(); } catch { return; }
    if (session.companyId === userId) onChange({ ...cache });
  };
  let cache = { stores: [], invoices: [], quotes: [], tasks: [] };

  const unsubStores = onSnapshot(collection(db, "companies", userId, "stores"), async (snap) => {
    const version = ++storeVersion;
    try {
      const storePromises = snap.docs.map(async (docSnap) => {
        const data = docSnap.data();
        const products = await loadStoreProducts(data, docSnap.id, userId);
        return {
          id: docSnap.id,
          name: data.name || "Price Book",
          location: data.location || "Main Location",
          products: products
        };
      });
      const stores = await Promise.all(storePromises);
      if (version !== storeVersion || !active) return;
      cache.stores = stores;
      ready.add("stores");
      emit();
    } catch (err) {
      fail(err);
    }
  }, fail);

  const unsubInvoices = onSnapshot(collection(db, "companies", userId, "invoices"), (snap) => {
    cache.invoices = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    ready.add("invoices");
    emit();
  }, fail);

  const unsubQuotes = onSnapshot(collection(db, "companies", userId, "quotes"), (snap) => {
    cache.quotes = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    ready.add("quotes");
    emit();
  }, fail);

  const unsubTasks = onSnapshot(collection(db, "companies", userId, "tasks"), (snap) => {
    cache.tasks = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    ready.add("tasks");
    emit();
  }, fail);

  return () => {
    active = false;
    unsubStores();
    unsubInvoices();
    unsubQuotes();
    unsubTasks();
  };
}

// Stores & Price Books CRUD
export async function saveStoreDoc(store) {
  const userId = owner();
  if (!store || !store.id) return;
  try {
    const products = store.products || [];
    const meta = {
      id: store.id,
      name: store.name || "Price Book",
      location: store.location || "Main Location",
      productCount: products.length,
      updatedAt: Date.now()
    };

    const oldChunks = await getDocs(collection(db, "companies", userId, "stores", store.id, "chunks"));
    const chunksCount = products.length > CHUNK_SIZE ? Math.ceil(products.length / CHUNK_SIZE) : 0;
    if (chunksCount + oldChunks.size + 1 > 450) throw new Error("Price book is too large");
    const batch = writeBatch(db);
    oldChunks.forEach(chunk => batch.delete(chunk.ref));
    for (let i = 0; i < chunksCount; i++) {
      const chunkId = `chunk_${String(i).padStart(4, "0")}`;
      batch.set(doc(db, "companies", userId, "stores", store.id, "chunks", chunkId), {
        items: products.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      });
    }
    batch.set(doc(db, "companies", userId, "stores", store.id), {
      ...meta, products: chunksCount ? [] : products, hasChunks: chunksCount > 0
    });
    await batch.commit();
  } catch (err) {
    console.error("saveStoreDoc error:", err);
    throw err;
  }
}

export async function deleteStoreDoc(storeId) {
  const userId = owner();
  if (!storeId) return;
  try {
    const chunksSnap = await getDocs(collection(db, "companies", userId, "stores", storeId, "chunks"));
    for (const cDoc of chunksSnap.docs) {
      await deleteDoc(doc(db, "companies", userId, "stores", storeId, "chunks", cDoc.id));
    }
    await deleteDoc(doc(db, "companies", userId, "stores", storeId));
  } catch (err) {
    console.error("deleteStoreDoc error:", err);
    throw err;
  }
}

export function cleanForFirestore(obj) {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map(cleanForFirestore);
  }
  const cleaned = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      cleaned[key] = cleanForFirestore(val);
    }
  }
  return cleaned;
}

// Invoices CRUD
export async function saveInvoiceDoc(invoice) {
  const userId = owner();
  if (!invoice || !invoice.id) return;
  try {
    const safeId = String(invoice.id).replace(/[/]/g, "-").trim();
    const cleanInv = cleanForFirestore({ ...invoice, id: safeId });
    await setDoc(doc(db, "companies", userId, "invoices", safeId), cleanInv);
  } catch (err) {
    console.error("saveInvoiceDoc error:", err);
    throw err;
  }
}

export async function deleteInvoiceDoc(invoiceId) {
  const userId = owner();
  if (!invoiceId) return;
  try {
    const safeId = String(invoiceId).replace(/[/]/g, "-").trim();
    await deleteDoc(doc(db, "companies", userId, "invoices", safeId));
  } catch (err) {
    console.error("deleteInvoiceDoc error:", err);
    throw err;
  }
}

// Quotes CRUD
export async function saveQuoteDoc(quote) {
  const userId = owner();
  if (!quote || !quote.id) return;
  try {
    const cleanQuote = cleanForFirestore(quote);
    await setDoc(doc(db, "companies", userId, "quotes", quote.id), cleanQuote);
  } catch (err) {
    console.error("saveQuoteDoc error:", err);
    throw err;
  }
}

export async function deleteQuoteDoc(quoteId) {
  const userId = owner();
  if (!quoteId) return;
  try {
    await deleteDoc(doc(db, "companies", userId, "quotes", quoteId));
  } catch (err) {
    console.error("deleteQuoteDoc error:", err);
    throw err;
  }
}

// Tasks CRUD
export async function saveTaskDoc(task) {
  const userId = owner();
  if (!task || !task.id) return;
  try {
    const cleanTask = cleanForFirestore(task);
    await setDoc(doc(db, "companies", userId, "tasks", task.id), cleanTask);
  } catch (err) {
    console.error("saveTaskDoc error:", err);
    throw err;
  }
}

export async function deleteTaskDoc(taskId) {
  const userId = owner();
  if (!taskId) return;
  try {
    await deleteDoc(doc(db, "companies", userId, "tasks", taskId));
  } catch (err) {
    console.error("deleteTaskDoc error:", err);
    throw err;
  }
}

