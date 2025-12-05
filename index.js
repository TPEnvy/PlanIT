// src/functions/index.js
// Node ESM backend for PlanIT notifications (FireStore + SendGrid).
// Save to: D:/Scheduling System/plan-it/src/functions/index.js
// Run from project root: node src/functions/index.js
// Ensure "type":"module" in package.json or run with an ESM-capable Node (v16+).

import express from "express";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- Config -----
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "service-account.json");
// optional: allow overriding service-account path via env
const SERVICE_ACCOUNT_OVERRIDE = process.env.SERVICE_ACCOUNT_PATH;
const SERVICE_ACCOUNT = SERVICE_ACCOUNT_OVERRIDE || SERVICE_ACCOUNT_PATH;

if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error("❌ service-account.json not found at", SERVICE_ACCOUNT);
  console.error("Place your Firebase service account JSON there and retry.");
  process.exit(1);
}

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@planit.local";
if (!SENDGRID_API_KEY) {
  console.warn("⚠ SENDGRID_API_KEY not set — running in NO-EMAIL (debug) mode.");
}
sgMail.setApiKey(SENDGRID_API_KEY);

// ----- Firebase Admin init -----
try {
  admin.initializeApp({
    credential: admin.credential.cert(SERVICE_ACCOUNT),
  });
} catch (err) {
  // if already initialized in the same node process, ignore
  if (!/already exists/.test(String(err))) {
    console.error("Firebase admin init error:", err);
    process.exit(1);
  }
}
const firestore = admin.firestore();

// ----- Utilities & constants -----
const RUNNER_ID = `${os.hostname()}_${process.pid}_${Date.now()}`;
const CLAIM_TIMEOUT_SECONDS = Number(process.env.CLAIM_TIMEOUT_SECONDS || 120); // claim expiry
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60 * 1000); // 1 minute

function tsNow() {
  return admin.firestore.Timestamp.fromMillis(Date.now());
}

async function tryClaimNotification(docRef, finalFlagField, claimField) {
  const nowMs = Date.now();
  try {
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.exists ? snap.data() : {};

      // If already notified, do not claim
      if (data && data[finalFlagField] === true) {
        throw { reason: "already_notified" };
      }

      // If claim exists and is fresh, do not claim
      if (data && data[claimField]) {
        const claimedAt = data[claimField].claimedAt;
        const claimedAtMs = claimedAt && typeof claimedAt.toMillis === "function" ? claimedAt.toMillis() : null;
        const ageMs = claimedAtMs ? nowMs - claimedAtMs : Infinity;
        if (ageMs < CLAIM_TIMEOUT_SECONDS * 1000) {
          throw { reason: "already_claimed" };
        }
        // stale claim -> overwrite below
      }

      tx.update(docRef, {
        [claimField]: { runner: RUNNER_ID, claimedAt: tsNow() },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  } catch (err) {
    if (err && err.reason) return { ok: false, reason: err.reason };
    console.warn("tryClaimNotification transaction error:", err);
    return { ok: false, reason: "tx_error" };
  }
}

async function releaseClaim(docRef, claimField) {
  try {
    await docRef.update({
      [claimField]: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("releaseClaim failed:", err);
  }
}

async function markNotifiedSuccess(docRef, finalFlagField, claimField) {
  try {
    await docRef.update({
      [finalFlagField]: true,
      [`${finalFlagField}At`]: admin.firestore.FieldValue.serverTimestamp(),
      [claimField]: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("markNotifiedSuccess failed:", err);
  }
}

async function sendEmailSendGrid(to, subject, html) {
  const msg = { to, from: FROM_EMAIL, subject, html };
  if (!SENDGRID_API_KEY) {
    // Debug mode (no email)
    console.info("(NO-EMAIL) debug send:", msg);
    return { ok: true, debug: true };
  }
  await sgMail.send(msg);
  return { ok: true };
}

async function sendNotificationForTask(uid, taskSnap, reasonText, finalFlag, claimField) {
  const docRef = taskSnap.ref;
  const task = taskSnap.data() || {};

  // Attempt atomic claim
  const claim = await tryClaimNotification(docRef, finalFlag, claimField);
  if (!claim.ok) {
    // skip if someone else claimed or error
    return { sent: false, reason: claim.reason || "claim_failed" };
  }

  // Lookup user email from users/{uid} doc
  let toEmail = null;
  try {
    const userSnap = await firestore.doc(`users/${uid}`).get();
    if (userSnap.exists) {
      const ud = userSnap.data();
      if (ud && ud.email) toEmail = ud.email;
    }
  } catch (err) {
    console.warn("Failed to load user email for", uid, err);
  }

  if (!toEmail) {
    // mark as notified (no email) to prevent infinite retries
    await markNotifiedSuccess(docRef, finalFlag, claimField);
    return { sent: false, reason: "no_user_email" };
  }

  const subject = `PlanIT — "${task.title || "Task"}" ${reasonText}`;
  const html = `
    <p>Reminder for task: <strong>${task.title || "Untitled task"}</strong></p>
    <p>${reasonText}</p>
    <p><strong>Start:</strong> ${task.startAt ? (typeof task.startAt.toDate === "function" ? task.startAt.toDate().toLocaleString() : String(task.startAt)) : "—"}</p>
    <p><strong>End:</strong> ${task.endAt ? (typeof task.endAt.toDate === "function" ? task.endAt.toDate().toLocaleString() : String(task.endAt)) : "—"}</p>
    <hr />
    <p>This email was generated by your local PlanIT backend runner: <small>${RUNNER_ID}</small></p>
  `;

  try {
    await sendEmailSendGrid(toEmail, subject, html);
    await markNotifiedSuccess(docRef, finalFlag, claimField);
    return { sent: true };
  } catch (err) {
    console.error("Failed to send email for task", docRef.path, err && err.message ? err.message : err);
    // release claim so later runs can retry
    await releaseClaim(docRef, claimField);
    return { sent: false, reason: "send_failed" };
  }
}

// ----- Scheduler pass -----
async function schedulerPass() {
  console.log(`[scheduler] run at ${new Date().toLocaleString()} (runner: ${RUNNER_ID})`);

  try {
    const usersCol = firestore.collection("users");
    const usersSnap = await usersCol.get();

    const nowMs = Date.now();
    const nowTs = admin.firestore.Timestamp.fromMillis(nowMs);
    const in24hTs = admin.firestore.Timestamp.fromMillis(nowMs + 24 * 3600 * 1000);
    const in5mTs = admin.firestore.Timestamp.fromMillis(nowMs + 5 * 60 * 1000);
    const past5mTs = admin.firestore.Timestamp.fromMillis(nowMs - 5 * 60 * 1000);

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // queries for each notification type (only tasks with startAt/endAt timestamps)
      // 1) starts within 24 hours (and not notifiedLessThanDay)
      const q24 = firestore.collection(`users/${uid}/tasks`)
        .where("startAt", ">=", nowTs)
        .where("startAt", "<=", in24hTs)
        .where("notifiedLessThanDay", "==", false);

      // 2) starts in 5 minutes (notifiedBeforeStart)
      const q5start = firestore.collection(`users/${uid}/tasks`)
        .where("startAt", ">=", nowTs)
        .where("startAt", "<=", in5mTs)
        .where("notifiedBeforeStart", "==", false);

      // 3) is starting now (within past 5m .. next 5m) (notifiedAtStart)
      const qAtStart = firestore.collection(`users/${uid}/tasks`)
        .where("startAt", ">=", past5mTs)
        .where("startAt", "<=", in5mTs)
        .where("notifiedAtStart", "==", false);

      // 4) ends in 5 minutes (notifiedBeforeEnd)
      const q5end = firestore.collection(`users/${uid}/tasks`)
        .where("endAt", ">=", nowTs)
        .where("endAt", "<=", in5mTs)
        .where("notifiedBeforeEnd", "==", false);

      // 5) has ended now (notifiedAtEnd)
      const qAtEnd = firestore.collection(`users/${uid}/tasks`)
        .where("endAt", ">=", past5mTs)
        .where("endAt", "<=", in5mTs)
        .where("notifiedAtEnd", "==", false);

      const queries = [
        { q: q24, reason: "starts within 24 hours", finalFlag: "notifiedLessThanDay", claimField: "claim_notifiedLessThanDay" },
        { q: q5start, reason: "starts in 5 minutes", finalFlag: "notifiedBeforeStart", claimField: "claim_notifiedBeforeStart" },
        { q: qAtStart, reason: "is starting now", finalFlag: "notifiedAtStart", claimField: "claim_notifiedAtStart" },
        { q: q5end, reason: "ends in 5 minutes", finalFlag: "notifiedBeforeEnd", claimField: "claim_notifiedBeforeEnd" },
        { q: qAtEnd, reason: "has ended", finalFlag: "notifiedAtEnd", claimField: "claim_notifiedAtEnd" },
      ];

      for (const qi of queries) {
        try {
          const snap = await qi.q.get();
          for (const taskDoc of snap.docs) {
            // send (idempotent via claim)
            await sendNotificationForTask(uid, taskDoc, qi.reason, qi.finalFlag, qi.claimField);
          }
        } catch (err) {
          console.warn("query loop error:", err);
        }
      }
    }
  } catch (err) {
    console.error("[scheduler] run failed:", err);
  }

  console.log("[scheduler] pass completed");
}

// ----- Express minimal API (health + test) -----
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), runner: RUNNER_ID });
});

app.post("/test-email", async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    if (!to) return res.status(400).json({ error: "missing 'to'" });
    const html = `<p>${message || "Test message"}</p>`;
    if (!SENDGRID_API_KEY) {
      console.log("(NO-EMAIL) test-email:", { to, subject, message });
      return res.json({ debug: true, to, subject });
    }
    await sendEmailSendGrid(to, subject || "PlanIT test email", html);
    return res.json({ ok: true });
  } catch (err) {
    console.error("test-email failed:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// start
const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`Backend HTTP listening on http://localhost:${PORT}`);
  // start scheduler
  schedulerPass().catch((e) => console.error("Initial scheduler error:", e));
  setInterval(() => schedulerPass().catch((e) => console.error("Scheduler error:", e)), POLL_INTERVAL_MS);
});
