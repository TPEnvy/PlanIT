import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AdminConfigurationError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "AdminConfigurationError";
    this.code = "ADMIN_CONFIG_ERROR";

    if (cause) {
      this.cause = cause;
    }
  }
}

function parseServiceAccountJson(raw, sourceLabel) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new AdminConfigurationError(
      `Failed to parse Firebase Admin credentials from ${sourceLabel}.`,
      error
    );
  }
}

function loadServiceAccountFromDiscreteEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId && !clientEmail && !privateKey) {
    return null;
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new AdminConfigurationError(
      "Firebase Admin credentials are incomplete. Set FIREBASE_SERVICE_ACCOUNT_JSON or all of FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

function loadServiceAccount() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    return parseServiceAccountJson(
      serviceAccountJson,
      "FIREBASE_SERVICE_ACCOUNT_JSON"
    );
  }

  const discreteEnvAccount = loadServiceAccountFromDiscreteEnv();
  if (discreteEnvAccount) {
    return discreteEnvAccount;
  }

  const configuredPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, "..", "..", "service-account.json");

  try {
    const raw = fs.readFileSync(configuredPath, "utf8");
    return parseServiceAccountJson(raw, configuredPath);
  } catch (error) {
    if (error instanceof AdminConfigurationError) {
      throw error;
    }

    if (error?.code === "ENOENT") {
      throw new AdminConfigurationError(
        "Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY variables before using the scheduling API.",
        error
      );
    }

    throw new AdminConfigurationError(
      `Failed to load Firebase Admin credentials from ${configuredPath}.`,
      error
    );
  }
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

  getAdminApp();

  return admin.auth().verifyIdToken(idToken);
}

export { admin };
export { AdminConfigurationError };
