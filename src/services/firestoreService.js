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
    { id: "INV-1048", vendor: "Core-Mark", date: "2026-09-01", total: 1847.23, status: "Pending", storeId: "s101", items: 46 },
    { id: "INV-1047", vendor: "McLane", date: "2026-08-30", total: 963.55, status: "Paid", storeId: "s101", items: 31 },
    { id: "INV-1046", vendor: "Great Lakes Beverage", date: "2026-08-28", total: 2211.08, status: "Paid", storeId: "s102", items: 18 }
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
        await setDoc(doc(db, "stores", store.id), store);
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

// Real-time listener for all app collections
export function subscribeToFirestore(onChange) {
  let cache = { stores: [], invoices: [], quotes: [], tasks: [] };

  const unsubStores = onSnapshot(collection(db, "stores"), (snap) => {
    cache.stores = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    onChange({ ...cache });
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
  await setDoc(doc(db, "stores", store.id), store);
}

export async function deleteStoreDoc(storeId) {
  await deleteDoc(doc(db, "stores", storeId));
}

// Invoices CRUD
export async function saveInvoiceDoc(invoice) {
  await setDoc(doc(db, "invoices", invoice.id), invoice);
}

export async function deleteInvoiceDoc(invoiceId) {
  await deleteDoc(doc(db, "invoices", invoiceId));
}

// Quotes CRUD
export async function saveQuoteDoc(quote) {
  await setDoc(doc(db, "quotes", quote.id), quote);
}

export async function deleteQuoteDoc(quoteId) {
  await deleteDoc(doc(db, "quotes", quoteId));
}

// Tasks CRUD
export async function saveTaskDoc(task) {
  await setDoc(doc(db, "tasks", task.id), task);
}

export async function deleteTaskDoc(taskId) {
  await deleteDoc(doc(db, "tasks", taskId));
}
