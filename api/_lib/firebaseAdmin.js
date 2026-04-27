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

function parseJsonCredentialValue(raw, sourceLabel) {
  const text = String(raw || "").trim();
  const candidates = [text];
  const strippedText = stripWrappingQuotes(text);

  if (strippedText !== text) {
    candidates.push(strippedText);
  }

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    } catch (error) {
      lastError = error;
    }
  }

  throw new AdminConfigurationError(
    `Failed to parse Firebase Admin credentials from ${sourceLabel}.`,
    lastError
  );
}

function parseServiceAccountJson(raw, sourceLabel) {
  try {
    const parsed = parseJsonCredentialValue(raw, sourceLabel);
    const normalized = normalizeServiceAccount(parsed);

    if (!normalized) {
      throw new AdminConfigurationError(
        `${sourceLabel} does not contain project_id, client_email, and private_key.`
      );
    }

    return normalized;
  } catch (error) {
    if (error instanceof AdminConfigurationError) {
      throw error;
    }

    throw error;
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
      "Incomplete Firebase Admin credential variables. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY together."
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: stripWrappingQuotes(privateKey).replace(/\\n/g, "\n"),
  };
}

function isRailwayRuntime() {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_ENVIRONMENT_ID ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID
  );
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

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const configuredAccount = loadServiceAccountFromFile(
      process.env.GOOGLE_APPLICATION_CREDENTIALS
    );

    if (configuredAccount) {
      return configuredAccount;
    }
  }

  if (isRailwayRuntime()) {
    throw new AdminConfigurationError(
      "Firebase Admin credentials are missing in Railway. Set FIREBASE_SERVICE_ACCOUNT_JSON on the PlanIT web service, set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY together, or set GOOGLE_APPLICATION_CREDENTIALS to an uploaded credential file."
    );
  }

  const bundledServiceAccountPath = path.join(
    __dirname,
    "..",
    "..",
    "service-account.json"
  );
  const configuredPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || bundledServiceAccountPath;
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

export function isAdminCredentialRuntimeError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "");
  const message = String(
    error?.message || error?.errorInfo?.message || error?.details || ""
  );

  return (
    code === "app/invalid-credential" ||
    message.includes("invalid_grant") ||
    message.includes("Invalid JWT Signature") ||
    message.includes("failed to fetch a valid Google OAuth2 access token")
  );
}

export { admin };
export { AdminConfigurationError };
