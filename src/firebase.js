import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD-BBP33GiMgfwG_Gv6b7VF9t5tMMUzEJw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "dailywebsite-7a26c.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "dailywebsite-7a26c",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "dailywebsite-7a26c.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "332072339979",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:332072339979:web:5f84cf3de730fc47d8d50e",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-Z0BFSBF6JN"
};

// Initialize Firebase, Firestore & Auth
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Safely initialize Analytics if supported in environment
let analytics = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}

let workspaceSession = null;
export function setWorkspaceSession(session) { workspaceSession = session; }
export function getWorkspaceSession() {
  if (!auth.currentUser || workspaceSession?.uid !== auth.currentUser.uid) throw new Error("Workspace session required");
  return workspaceSession;
}
export { app, db, auth, analytics };
export default app;
