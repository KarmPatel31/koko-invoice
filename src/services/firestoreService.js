import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot
} from "firebase/firestore";
import { db } from "../firebase.js";

// Seed data fallback
export const initialSeed = {
  stores: [
    {
      id: "s101",
      name: "Store #101",
      location: "Main Street",
      products: [
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
      detail: {
        invoiceNumber: "INV-1048", vendor: "Core-Mark", invoiceDate: "2026-09-01", total: 1847.23,
        items: [
          { upc: "049000050103", description: "Coca-Cola 20oz Bottle 24ct", category: "Beverages", quantity: 2, unitPrice: 1.85, srp: 2.49, lineTotal: 44.40 },
          { upc: "028400090896", description: "Lay's Classic Potato Chips 2.65oz", category: "Candy & Snacks", quantity: 1, unitPrice: 1.95, srp: 2.69, lineTotal: 23.40 },
          { upc: "012000001017", description: "Pepsi Wild Cherry 20oz", category: "Beverages", quantity: 1, unitPrice: 1.85, srp: 2.49, lineTotal: 22.20 },
          { upc: "034000004400", description: "Hershey's Milk Chocolate Bar 1.55oz", category: "Candy & Snacks", quantity: 3, unitPrice: 1.15, srp: 1.69, lineTotal: 41.40 }
        ]
      }
    },
    {
      id: "INV-1047", vendor: "McLane", date: "2026-08-30", total: 963.55, status: "Paid", storeId: "s101", items: 4,
      detail: {
        invoiceNumber: "INV-1047", vendor: "McLane", invoiceDate: "2026-08-30", total: 963.55,
        items: [
          { upc: "049000050103", description: "Coca-Cola 20oz Bottle 24ct", category: "Beverages", quantity: 2, unitPrice: 1.85, srp: 2.49, lineTotal: 44.40 },
          { upc: "028400090896", description: "Lay's Classic Potato Chips 2.65oz", category: "Candy & Snacks", quantity: 1, unitPrice: 1.95, srp: 2.69, lineTotal: 23.40 }
        ]
      }
    },
    {
      id: "INV-1046", vendor: "Great Lakes Beverage", date: "2026-08-28", total: 2211.08, status: "Paid", storeId: "s102", items: 4,
      detail: {
        invoiceNumber: "INV-1046", vendor: "Great Lakes Beverage", invoiceDate: "2026-08-28", total: 2211.08,
        items: [
          { upc: "012000001017", description: "Pepsi Wild Cherry 20oz", category: "Beverages", quantity: 1, unitPrice: 1.85, srp: 2.49, lineTotal: 22.20 }
        ]
      }
    }
  ],
  quotes: [
    { id: "Q-204", client: "Store #101", vendor: "ABC Fixtures", amount: 1250, status: "Open", date: "2026-09-02" }
  ],
  tasks: [
    { id: "t1", title: "Review Core-Mark price increases", tag: "Invoice", done: false },
    { id: "t2", title: "Upload September Store #102 price book", tag: "PriceBook", done: false },
    { id: "t3", title: "Approve cooler quote", tag: "Quote", done: true }
  ]
};

// Seed Firestore collections if empty
export async function seedFirestoreIfEmpty() {
  try {
    const storesSnap = await getDocs(collection(db, "stores"));
    if (storesSnap.empty) {
      for (const store of initialSeed.stores) {
        await saveStoreDoc(store);
      }
    }

    const invoicesSnap = await getDocs(collection(db, "invoices"));
    if (invoicesSnap.empty) {
      for (const inv of initialSeed.invoices) {
        await setDoc(doc(db, "invoices", inv.id), inv);
      }
    }

    const quotesSnap = await getDocs(collection(db, "quotes"));
    if (quotesSnap.empty) {
      for (const quote of initialSeed.quotes) {
        await setDoc(doc(db, "quotes", quote.id), quote);
      }
    }

    const tasksSnap = await getDocs(collection(db, "tasks"));
    if (tasksSnap.empty) {
      for (const task of initialSeed.tasks) {
        await setDoc(doc(db, "tasks", task.id), task);
      }
    }
  } catch (err) {
    console.error("Firestore seeding error:", err);
  }
}

const CHUNK_SIZE = 250;

async function loadStoreProducts(data, storeId) {
  if (!data.hasChunks) {
    return data.products || [];
  }
  try {
    const chunksSnap = await getDocs(collection(db, "stores", storeId, "chunks"));
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
    return data.products || [];
  }
}

// Real-time listener for all app collections
export function subscribeToFirestore(onChange) {
  let cache = { stores: [], invoices: [], quotes: [], tasks: [] };

  const unsubStores = onSnapshot(collection(db, "stores"), async (snap) => {
    try {
      const storePromises = snap.docs.map(async (docSnap) => {
        const data = docSnap.data();
        const products = await loadStoreProducts(data, docSnap.id);
        return {
          id: docSnap.id,
          name: data.name || "Price Book",
          location: data.location || "Main Location",
          products: products
        };
      });
      cache.stores = await Promise.all(storePromises);
      onChange({ ...cache });
    } catch (err) {
      console.error("Error reading stores snapshot:", err);
    }
  });

  const unsubInvoices = onSnapshot(collection(db, "invoices"), (snap) => {
    cache.invoices = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    onChange({ ...cache });
  });

  const unsubQuotes = onSnapshot(collection(db, "quotes"), (snap) => {
    cache.quotes = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    onChange({ ...cache });
  });

  const unsubTasks = onSnapshot(collection(db, "tasks"), (snap) => {
    cache.tasks = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    onChange({ ...cache });
  });

  return () => {
    unsubStores();
    unsubInvoices();
    unsubQuotes();
    unsubTasks();
  };
}

// Stores & Price Books CRUD
export async function saveStoreDoc(store) {
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

    if (products.length <= CHUNK_SIZE) {
      await setDoc(doc(db, "stores", store.id), {
        ...meta,
        products: products,
        hasChunks: false
      });
      return;
    }

    // Larger price books: store metadata in main doc and products in chunks
    await setDoc(doc(db, "stores", store.id), {
      ...meta,
      products: [],
      hasChunks: true
    });

    const chunksCount = Math.ceil(products.length / CHUNK_SIZE);
    for (let i = 0; i < chunksCount; i++) {
      const chunkItems = products.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkId = `chunk_${String(i).padStart(4, "0")}`;
      await setDoc(doc(db, "stores", store.id, "chunks", chunkId), {
        items: chunkItems
      });
    }
  } catch (err) {
    console.error("saveStoreDoc error:", err);
  }
}

export async function deleteStoreDoc(storeId) {
  if (!storeId) return;
  try {
    const chunksSnap = await getDocs(collection(db, "stores", storeId, "chunks"));
    for (const cDoc of chunksSnap.docs) {
      await deleteDoc(doc(db, "stores", storeId, "chunks", cDoc.id));
    }
    await deleteDoc(doc(db, "stores", storeId));
  } catch (err) {
    console.error("deleteStoreDoc error:", err);
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
  if (!invoice || !invoice.id) return;
  try {
    const safeId = String(invoice.id).replace(/[/]/g, "-").trim();
    const cleanInv = cleanForFirestore({ ...invoice, id: safeId });
    await setDoc(doc(db, "invoices", safeId), cleanInv);
  } catch (err) {
    console.error("saveInvoiceDoc error:", err);
  }
}

export async function deleteInvoiceDoc(invoiceId) {
  if (!invoiceId) return;
  try {
    const safeId = String(invoiceId).replace(/[/]/g, "-").trim();
    await deleteDoc(doc(db, "invoices", safeId));
  } catch (err) {
    console.error("deleteInvoiceDoc error:", err);
  }
}

// Quotes CRUD
export async function saveQuoteDoc(quote) {
  if (!quote || !quote.id) return;
  try {
    const cleanQuote = cleanForFirestore(quote);
    await setDoc(doc(db, "quotes", quote.id), cleanQuote);
  } catch (err) {
    console.error("saveQuoteDoc error:", err);
  }
}

export async function deleteQuoteDoc(quoteId) {
  if (!quoteId) return;
  try {
    await deleteDoc(doc(db, "quotes", quoteId));
  } catch (err) {
    console.error("deleteQuoteDoc error:", err);
  }
}

// Tasks CRUD
export async function saveTaskDoc(task) {
  if (!task || !task.id) return;
  try {
    const cleanTask = cleanForFirestore(task);
    await setDoc(doc(db, "tasks", task.id), cleanTask);
  } catch (err) {
    console.error("saveTaskDoc error:", err);
  }
}

export async function deleteTaskDoc(taskId) {
  if (!taskId) return;
  try {
    await deleteDoc(doc(db, "tasks", taskId));
  } catch (err) {
    console.error("deleteTaskDoc error:", err);
  }
}

