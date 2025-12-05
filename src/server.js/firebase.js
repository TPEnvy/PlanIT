// src/server.js/firebase.js

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database"; // only if you use Realtime DB

// --- Your real Firebase project config ---
const firebaseConfig = {
  apiKey: "AIzaSyArsbLJRI9GFgFRph8Upbpy8fNOCFwTd1A",
  authDomain: "planit-f2783.firebaseapp.com",
  projectId: "planit-f2783",
  storageBucket: "planit-f2783.firebasestorage.app",
  messagingSenderId: "1016048057274",
  appId: "1:1016048057274:web:6624e5e859785af6a63b83",
  measurementId: "G-BPQC3869B9",
};

// --- Initialize App ---
const app = initializeApp(firebaseConfig);

// --- Cloud Services ---
export const auth = getAuth(app);           // Cloud Firebase Auth
export const firestore = getFirestore(app); // Cloud Firestore DB

// Optional (if ever needed):
export const database = getDatabase(app);   // For Realtime Database (not required)

// --- Default export ---
export default app;
