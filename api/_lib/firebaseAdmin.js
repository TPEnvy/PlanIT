import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const configuredPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, "..", "..", "service-account.json");

  return JSON.parse(fs.readFileSync(configuredPath, "utf8"));
}

export function getAdminApp() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(loadServiceAccount()),
    });
  }

  return admin.app();
}

export function getAdminDb() {
  return getAdminApp().firestore();
}

export async function verifyBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");

  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    throw new Error("Missing bearer token.");
  }

  return admin.auth().verifyIdToken(idToken);
}

export { admin };
