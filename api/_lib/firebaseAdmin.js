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

function stripWrappingQuotes(value = "") {
  const text = String(value);
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  return text;
}

function normalizeServiceAccount(candidate) {
  if (!candidate) {
    return null;
  }

  if (typeof candidate === "string") {
    return null;
  }

  if (Array.isArray(candidate) || typeof candidate !== "object") {
    return null;
  }

  const wrappedCandidate =
    candidate.serviceAccount ||
    candidate.firebase ||
    candidate.credentials ||
    candidate.credential ||
    candidate.value ||
    candidate.data;

  if (wrappedCandidate && wrappedCandidate !== candidate) {
    return normalizeServiceAccount(wrappedCandidate);
  }

  const projectId = candidate.projectId || candidate.project_id;
  const clientEmail = candidate.clientEmail || candidate.client_email;
  const privateKey = candidate.privateKey || candidate.private_key;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId: String(projectId).trim(),
    clientEmail: String(clientEmail).trim(),
    privateKey: stripWrappingQuotes(privateKey).replace(/\\n/g, "\n"),
  };
}

function parseServiceAccountJson(raw, sourceLabel) {
  try {
    const parsed = JSON.parse(stripWrappingQuotes(raw));
    return normalizeServiceAccount(parsed) || parsed;
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
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: stripWrappingQuotes(privateKey).replace(/\\n/g, "\n"),
  };
}

function loadServiceAccountFromFile(configuredPath) {
  if (!configuredPath) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configuredPath, "utf8");
    return parseServiceAccountJson(raw, configuredPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw new AdminConfigurationError(
      `Failed to load Firebase Admin credentials from ${configuredPath}.`,
      error
    );
  }
}

function loadServiceAccount() {
  const bundledServiceAccountPath = path.join(
    __dirname,
    "..",
    "..",
    "service-account.json"
  );
  const bundledAccount = loadServiceAccountFromFile(bundledServiceAccountPath);
  if (bundledAccount) {
    return bundledAccount;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    try {
      const parsed = parseServiceAccountJson(
        serviceAccountJson,
        "FIREBASE_SERVICE_ACCOUNT_JSON"
      );
      const normalized = normalizeServiceAccount(parsed);

      if (normalized) {
        return normalized;
      }

      console.warn(
        "Ignoring FIREBASE_SERVICE_ACCOUNT_JSON because it does not look like a Firebase service account object. Falling back to other credential sources."
      );
    } catch (error) {
      console.warn(
        `Ignoring FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message} Falling back to other credential sources.`
      );
    }
  }

  const discreteEnvAccount = loadServiceAccountFromDiscreteEnv();
  if (discreteEnvAccount) {
    return discreteEnvAccount;
  }

  if (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    console.warn(
      "Ignoring incomplete FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY values and falling back to other credential sources."
    );
  }

  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const configuredAccount = loadServiceAccountFromFile(configuredPath);
  if (configuredAccount) {
    return configuredAccount;
  }

  throw new AdminConfigurationError(
    "Firebase Admin credentials are missing. Add service-account.json to the deployed app or set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

export function getAdminApp() {
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(loadServiceAccount()),
      });
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        throw error;
      }

      const credentialMessage =
        error?.errorInfo?.message || error?.message || "Unknown credential error.";

      throw new AdminConfigurationError(
        `Firebase Admin credentials are invalid. ${credentialMessage}`,
        error
      );
    }
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
