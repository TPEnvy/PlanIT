import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const fallbackFirebaseConfig = {
  apiKey: "AIzaSyArsbLJRI9GFgFRph8Upbpy8fNOCFwTd1A",
  authDomain: "planit-f2783.firebaseapp.com",
  projectId: "planit-f2783",
  storageBucket: "planit-f2783.firebasestorage.app",
  messagingSenderId: "1016048057274",
  appId: "1:1016048057274:web:6624e5e859785af6a63b83",
};

const requiredKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const envFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const missingEnvKeys = requiredKeys.filter((key) => !envFirebaseConfig[key]);

export const firebaseConfig = {
  ...fallbackFirebaseConfig,
  ...Object.fromEntries(
    Object.entries(envFirebaseConfig).filter(([, value]) => Boolean(value))
  ),
};

export const usingFallbackFirebaseConfig = missingEnvKeys.length > 0;
export const firebaseInitError =
  requiredKeys.filter((key) => !firebaseConfig[key]).length > 0
    ? `Missing Firebase environment variables: ${requiredKeys
        .filter((key) => !firebaseConfig[key])
        .join(", ")}`
    : null;

if (usingFallbackFirebaseConfig) {
  console.warn(
    `Firebase environment variables are incomplete. Using fallback config for: ${missingEnvKeys.join(
      ", "
    )}`
  );
}

const app = firebaseInitError ? null : initializeApp(firebaseConfig);

export const auth = app ? getAuth(app) : null;
export const firestore = app ? getFirestore(app) : null;
export const database = app ? getDatabase(app) : null;
export const firebaseVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
export const isPushNotificationsEnabled =
  import.meta.env.VITE_ENABLE_PUSH_NOTIFICATIONS !== "false" && Boolean(app);
export const isWebPushConfigured =
  isPushNotificationsEnabled && Boolean(firebaseVapidKey);

export default app;
