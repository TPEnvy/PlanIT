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
const MAX_REMINDER_DRIFT_MS = 30000;
const hasSmtpConfig = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
const transporter = hasSmtpConfig
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

function safeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReminderNotificationId(taskId, type) {
  return `reminder_${taskId}_${type}`;
}

async function resolveUserEmail(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    return user.email || null;
  } catch (error) {
    console.error("Failed to resolve user email:", error);
    return null;
  }
}

async function sendEmail(to, subject, text) {
  if (!to) {
    return false;
  }

  if (!transporter) {
    console.warn("SMTP is not configured. Skipping email notification.");
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"Plan-IT" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
    });
    console.log("Email sent:", subject);
    return true;
  } catch (error) {
    console.error("Email send failed:", error);
    return false;
  }
}

async function createNotification(uid, data, notificationId = null) {
  const ref = db.collection(`users/${uid}/notifications`);

  if (notificationId) {
    try {
      await ref.doc(notificationId).create({
        ...data,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return true;
    } catch (error) {
      if (error?.code === 6 || error?.code === "already-exists") {
        console.log("Duplicate notification skipped:", notificationId);
        return false;
      }

      throw error;
    }
  }

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

async function claimReminder(taskRef, { flagField, taskField, offsetMs }) {
  return db.runTransaction(async (transaction) => {
    const freshSnap = await transaction.get(taskRef);
    if (!freshSnap.exists) {
      return null;
    }

    const latestTask = freshSnap.data() || {};
    if (
      latestTask.status !== "pending" ||
      latestTask.isSplitParent ||
      latestTask[flagField]
    ) {
      return null;
    }

    const taskDate = safeDate(latestTask[taskField]);
    if (!taskDate) {
      return null;
    }

    const scheduledAt = taskDate.getTime() + offsetMs;
    const lateByMs = Date.now() - scheduledAt;
    if (lateByMs > MAX_REMINDER_DRIFT_MS) {
      console.log("Skipping stale notification:", taskRef.id, flagField);
      return null;
    }

    transaction.update(taskRef, {
      [flagField]: true,
    });

    return latestTask;
  });
}

async function processTask(docSnap) {
  const task = docSnap.data();
  const uid = task.userId;
  if (!uid) return;

  if (task.status !== "pending" || task.isSplitParent) {
    clearTaskTimers(docSnap.id);
    return;
  }

  const title = task.title || "Untitled Task";
  const start = safeDate(task.startAt);
  const end = safeDate(task.endAt);
  const userEmail = await resolveUserEmail(uid);

  clearTaskTimers(docSnap.id);

  if (start && !task.pushSent5m) {
    schedule(docSnap.id, "5m", start.getTime() - 300000, async () => {
      const latestTask = await claimReminder(docSnap.ref, {
        flagField: "pushSent5m",
        taskField: "startAt",
        offsetMs: -300000,
      });
      if (!latestTask) return;

      const latestTitle = latestTask.title || title;
      const body = `"${latestTitle}" starts in 5 minutes`;
      const created = await createNotification(uid, {
        title: "Starting Soon",
        body,
        taskId: docSnap.id,
        type: "5m",
      }, getReminderNotificationId(docSnap.id, "5m"));
      if (!created) return;

      await Promise.allSettled([
        sendPushToUser(uid, "Starting Soon", body),
        sendEmail(userEmail, "Starting Soon", body),
      ]);
    });
  }

  if (start && !task.pushSentStart) {
    schedule(docSnap.id, "start", start.getTime(), async () => {
      const latestTask = await claimReminder(docSnap.ref, {
        flagField: "pushSentStart",
        taskField: "startAt",
        offsetMs: 0,
      });
      if (!latestTask) return;

      const latestTitle = latestTask.title || title;
      const body = `"${latestTitle}" is starting now`;
      const created = await createNotification(uid, {
        title: "Task Started",
        body,
        taskId: docSnap.id,
        type: "start",
      }, getReminderNotificationId(docSnap.id, "start"));
      if (!created) return;

      await Promise.allSettled([
        sendPushToUser(uid, "Task Started", body),
        sendEmail(userEmail, "Task Started", body),
      ]);
    });
  }

  if (end && !task.pushSentBeforeEnd) {
    schedule(docSnap.id, "before_end", end.getTime() - 300000, async () => {
      const latestTask = await claimReminder(docSnap.ref, {
        flagField: "pushSentBeforeEnd",
        taskField: "endAt",
        offsetMs: -300000,
      });
      if (!latestTask) return;

      const latestTitle = latestTask.title || title;
      const body = `"${latestTitle}" ends in 5 minutes`;
      const created = await createNotification(uid, {
        title: "Task ending soon",
        body,
        taskId: docSnap.id,
        type: "before_end",
      }, getReminderNotificationId(docSnap.id, "before_end"));
      if (!created) return;

      await Promise.allSettled([
        sendPushToUser(uid, "Task ending soon", body),
        sendEmail(userEmail, "Task ending soon", body),
      ]);
    });
  }

  if (end && !task.pushSentEnd) {
    schedule(docSnap.id, "end", end.getTime(), async () => {
      const latestTask = await claimReminder(docSnap.ref, {
        flagField: "pushSentEnd",
        taskField: "endAt",
        offsetMs: 0,
      });
      if (!latestTask) return;

      const latestTitle = latestTask.title || title;
      const body = `"${latestTitle}" has ended`;
      const created = await createNotification(uid, {
        title: "Task Ended",
        body,
        taskId: docSnap.id,
        type: "end",
      }, getReminderNotificationId(docSnap.id, "end"));
      if (!created) return;

      await Promise.allSettled([
        sendPushToUser(uid, "Task Ended", body),
        sendEmail(userEmail, "Task Ended", body),
      ]);
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
