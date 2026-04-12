import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(
      fs.readFileSync(
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          path.join(__dirname, "service-account.json"),
        "utf8"
      )
    );

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function safeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolveUserEmail(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    return user.email || null;
  } catch {
    return null;
  }
}

async function sendEmail(to, subject, text) {
  if (!to) return;

  await transporter.sendMail({
    from: `"Plan-IT" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
  });
}

async function createNotification(uid, data) {
  const ref = db.collection(`users/${uid}/notifications`);
  const existing = await ref
    .where("taskId", "==", data.taskId)
    .where("type", "==", data.type)
    .limit(1)
    .get();

  if (!existing.empty) {
    console.log("Duplicate notification skipped:", data.type);
    return false;
  }

  await ref.add({
    ...data,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return true;
}

async function sendPushToUser(uid, title, body) {
  const snap = await db.collection(`users/${uid}/fcmTokens`).get();
  const tokens = [...new Set(snap.docs.map((docSnap) => docSnap.data().token))];

  if (!tokens.length) return;

  await admin.messaging().sendEachForMulticast({
    tokens,
    data: {
      title,
      body,
    },
  });

  console.log("Push sent:", title);
}

const timers = new Map();

function makeKey(id, type) {
  return `${id}_${type}`;
}

function clearTaskTimers(taskId) {
  for (const [key, timer] of timers) {
    if (key.startsWith(taskId)) {
      clearTimeout(timer);
      timers.delete(key);
    }
  }
}

function schedule(taskId, type, when, fn) {
  const key = makeKey(taskId, type);

  if (timers.has(key)) return;

  const delay = when - Date.now();
  if (delay <= 0) {
    console.log("Skipping late notification:", key);
    return;
  }

  const timeout = setTimeout(async () => {
    try {
      await fn();
    } catch (error) {
      console.error("Scheduler error:", error);
    } finally {
      timers.delete(key);
    }
  }, delay);

  timers.set(key, timeout);
}

async function processTask(docSnap) {
  const task = docSnap.data();
  const uid = task.userId;
  if (!uid) return;

  if (task.status !== "pending" || task.isSplitParent) {
    clearTaskTimers(docSnap.id);
    return;
  }

  const email = await resolveUserEmail(uid);
  const title = task.title || "Untitled Task";
  const start = safeDate(task.startAt);
  const end = safeDate(task.endAt);

  clearTaskTimers(docSnap.id);

  const isValid = async () => {
    const fresh = await docSnap.ref.get();
    const latest = fresh.data();
    return latest && latest.status === "pending" && !latest.isSplitParent;
  };

  if (start && !task.pushSent5m) {
    schedule(docSnap.id, "5m", start.getTime() - 300000, async () => {
      if (!(await isValid())) return;

      const body = `"${title}" starts in 5 minutes`;
      const created = await createNotification(uid, {
        title: "Starting Soon",
        body,
        taskId: docSnap.id,
        type: "5m",
      });

      await docSnap.ref.update({ pushSent5m: true });
      if (!created) return;

      await sendEmail(email, "Starting Soon", body);
      await sendPushToUser(uid, "Starting Soon", body);
    });
  }

  if (start && !task.pushSentStart) {
    schedule(docSnap.id, "start", start.getTime(), async () => {
      if (!(await isValid())) return;

      const body = `"${title}" is starting now`;
      const created = await createNotification(uid, {
        title: "Task Started",
        body,
        taskId: docSnap.id,
        type: "start",
      });

      await docSnap.ref.update({ pushSentStart: true });
      if (!created) return;

      await sendEmail(email, "Task Started", body);
      await sendPushToUser(uid, "Task Started", body);
    });
  }

  if (end && !task.pushSentBeforeEnd) {
    schedule(docSnap.id, "before_end", end.getTime() - 300000, async () => {
      if (!(await isValid())) return;

      const body = `"${title}" ends in 5 minutes`;
      const created = await createNotification(uid, {
        title: "Task ending soon",
        body,
        taskId: docSnap.id,
        type: "before_end",
      });

      await docSnap.ref.update({ pushSentBeforeEnd: true });
      if (!created) return;

      await sendEmail(email, "Task ending soon", body);
      await sendPushToUser(uid, "Task ending soon", body);
    });
  }

  if (end && !task.pushSentEnd) {
    schedule(docSnap.id, "end", end.getTime(), async () => {
      if (!(await isValid())) return;

      const body = `"${title}" has ended`;
      const created = await createNotification(uid, {
        title: "Task Ended",
        body,
        taskId: docSnap.id,
        type: "end",
      });

      await docSnap.ref.update({ pushSentEnd: true });
      if (!created) return;

      await sendEmail(email, "Task Ended", body);
      await sendPushToUser(uid, "Task Ended", body);
    });
  }
}

console.log("Notification System");

db.collectionGroup("tasks").onSnapshot((snapshot) => {
  snapshot.docChanges().forEach((change) => {
    const docSnap = change.doc;

    clearTaskTimers(docSnap.id);

    if (change.type === "removed") {
      return;
    }

    processTask(docSnap);
  });
});
