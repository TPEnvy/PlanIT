// src/contexts/NotificationContext.jsx
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getMessaging, getToken } from "firebase/messaging";
import { firestore } from "../server.js/firebase";
import { useAuth } from "./AuthContext";

/**
 * Configuration:
 * - Set VAPID_KEY if you want to register web push tokens (optional).
 * - If you do not use FCM web tokens, leave VAPID_KEY empty.
 */
const VAPID_KEY = ""; // <-- put your Web VAPID key here if using FCM web push

const NotificationContext = createContext(null);

/* ------------------ helpers ------------------ */

// safe conversion to Date (supports Firestore Timestamp, Date, ISO, ms)
function safeDate(val) {
  try {
    if (!val) return null;
    if (typeof val.toDate === "function") return val.toDate();
    if (val instanceof Date) return val;
    if (typeof val === "number") {
      const d = new Date(val);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof val === "string") {
      const d = new Date(val);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
  } catch (err) {
    console.error("safeDate error:", err);
    return null;
  }
}

// defer to microtask queue to avoid sync setState in effects
function defer(fn) {
  Promise.resolve().then(() => {
    try {
      fn();
    } catch (err) {
      console.error("defer callback error:", err);
    }
  });
}

// ensure value is a finite number (ms)
function isFiniteMs(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/* ------------------ provider ------------------ */

export function NotificationProvider({ children }) {
  const { user, loading: authLoading } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const timersRef = useRef(new Map()); // key -> timeoutId
  const unsubNotificationsRef = useRef(null);
  const unsubTasksRef = useRef(null);

  // clear timers helper
  function clearAllTimers() {
    const m = timersRef.current;
    for (const id of m.values()) {
      try {
        clearTimeout(id);
      } catch (err) {
        console.error("clearTimeout error:", err);
      }
    }
    timersRef.current = new Map();
  }

  // schedule helper (only if ms is finite and > 0)
  function scheduleTimer(key, ms, fn) {
    try {
      if (!isFiniteMs(ms)) {
        console.warn(`Not scheduling timer ${key}: ms not finite (${ms})`);
        return null;
      }
      // avoid scheduling timers for past events
      if (ms <= 0) {
        console.warn(`Not scheduling timer ${key}: ms <= 0 (${ms})`);
        return null;
      }

      // clear existing
      if (timersRef.current.has(key)) {
        try {
          clearTimeout(timersRef.current.get(key));
        } catch (err) {
          console.error("clearTimeout error:", err);
        }
        timersRef.current.delete(key);
      }

      const id = setTimeout(() => {
        try {
          fn();
        } catch (err) {
          console.error(`Scheduled callback (${key}) error:`, err);
        } finally {
          timersRef.current.delete(key);
        }
      }, ms);

      timersRef.current.set(key, id);
      return id;
    } catch (err) {
      console.error("scheduleTimer error:", err);
      return null;
    }
  }

  // create a notification document in Firestore for UI
  async function createNotificationDoc(uid, { title, body, taskId = null, type = "reminder" }) {
    if (!uid) {
      console.warn("createNotificationDoc skipped: missing uid");
      return;
    }
    try {
      const col = collection(firestore, `users/${uid}/notifications`);
      await addDoc(col, {
        title,
        body,
        taskId,
        type,
        createdAt: serverTimestamp(),
        read: false,
        channel: "reminder",
      });
    } catch (err) {
      console.error("createNotificationDoc failed:", err);
    }
  }

  // show native browser notification (requests permission when needed)
  async function showBrowserNotification(title, body) {
    try {
      if (typeof window === "undefined" || typeof Notification === "undefined") {
        return;
      }

      if (Notification.permission === "granted") {

        new Notification(title, { body });
        return;
      }

      if (Notification.permission === "default") {
        try {
          const perm = await Notification.requestPermission();
          if (perm === "granted") {
            new Notification(title, { body });
          } else {
            console.info("Browser notification denied or dismissed");
          }
        } catch (err) {
          console.error("Notification.requestPermission() failed:", err);
        }
      }
    } catch (err) {
      console.error("showBrowserNotification error:", err);
    }
  }

  // best-effort: set a boolean flag on the task doc (client-side)
  async function setTaskFlag(uid, taskId, flagName) {
    if (!uid || !taskId || !flagName) return;
    try {
      const tRef = doc(firestore, `users/${uid}/tasks/${taskId}`);
      await updateDoc(tRef, { [flagName]: true });
    } catch (err) {
      // Log but don't crash — server cloud function should be authoritative
      console.warn(`setTaskFlag failed for ${uid}/${taskId} ${flagName}:`, err);
    }
  }

  // optional: register web push token (FCM) and store under users/{uid}/fcmTokens
  async function registerFcmToken(uid) {
    if (!uid) return;
    if (!VAPID_KEY) {
      // no VAPID configured; skip
      return;
    }
    try {
      const messaging = getMessaging();
      const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
      if (!currentToken) {
        console.info("No FCM token obtained (user may have blocked or unsupported)");
        return;
      }
      try {
        // store token doc
        const tokenCol = collection(firestore, `users/${uid}/fcmTokens`);
        // using setDoc with automatic id to avoid overwriting a token doc — it's okay if duplicates exist
        await addDoc(tokenCol, { token: currentToken, createdAt: serverTimestamp() });
      } catch (err) {
        console.error("Storing FCM token failed:", err);
      }
    } catch (err) {
      console.warn("registerFcmToken failed:", err);
    }
  }

  /* ------------------ notifications collection subscription ------------------ */
  useEffect(() => {
    // wait until auth has resolved
    if (authLoading) return;

    // if user signed out: clear, cancel timers & unsub
    if (!user) {
      defer(() => {
        setNotifications([]);
        setLoading(false);
      });

      clearAllTimers();

      if (unsubNotificationsRef.current) {
        try {
          unsubNotificationsRef.current();
        } catch (err) {
          console.error("Unsubscribe notification error:", err);
        }
        unsubNotificationsRef.current = null;
      }

      return;
    }

    // user exists: subscribe to notifications
    defer(() => setLoading(true));

    const notifCol = collection(firestore, `users/${user.uid}/notifications`);
    const q = query(notifCol, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        try {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          defer(() => {
            setNotifications(list);
            setLoading(false);
          });
        } catch (err) {
          console.error("onSnapshot processing error:", err);
        }
      },
      (err) => {
        console.error("notifications onSnapshot error:", err);
        defer(() => {
          setNotifications([]);
          setLoading(false);
        });
      }
    );

    unsubNotificationsRef.current = unsub;

    // try to register FCM token (best-effort)
    registerFcmToken(user.uid).catch((err) => {
      console.warn("registerFcmToken catch:", err);
    });

    // cleanup
    return () => {
      if (unsubNotificationsRef.current) {
        try {
          unsubNotificationsRef.current();
        } catch (err) {
          console.error("unsub notifications cleanup error:", err);
        }
        unsubNotificationsRef.current = null;
      }
    };
  }, [user, authLoading]);

  /* ------------------ schedule per-task reminders (client in-session) ------------------ */
  useEffect(() => {
    if (authLoading) return;

    // clear any previous timers and subscription
    clearAllTimers();
    if (unsubTasksRef.current) {
      try {
        unsubTasksRef.current();
      } catch (err) {
        console.error("unsub tasks error:", err);
      }
      unsubTasksRef.current = null;
    }

    if (!user) return;

    // subscribe to user's tasks
    const tasksCol = collection(firestore, `users/${user.uid}/tasks`);
    const q = query(tasksCol);

    const unsub = onSnapshot(
      q,
      (snap) => {
        try {
          // reschedule based on fresh snapshot
          clearAllTimers();

          const nowMs = Date.now();

          snap.docs.forEach((d) => {
            const raw = d.data();
            const taskId = d.id;
            const t = { id: taskId, ...raw };

            // parse times safely
            const startDate = safeDate(t.startAt);
            const endDate = safeDate(t.endAt);
            const dueDate = safeDate(t.dueDate);

            const startMs = startDate ? startDate.getTime() : null;
            const endMs = endDate ? endDate.getTime() : null;
            const dueMs = dueDate ? dueDate.getTime() : null;

            // primary event for 24h reminder => prefer start, then due, then end
            const primaryMs = startMs || dueMs || endMs || null;

            /* ---------- 24-hour (less-than-day) reminder ---------- */
            if (primaryMs && !t.notifiedLessThanDay) {
              if (!isFiniteMs(primaryMs)) {
                console.warn(`Skipping 24h reminder for ${taskId}: invalid primaryMs`, primaryMs);
              } else {
                const msUntil24h = primaryMs - nowMs - 24 * 60 * 60 * 1000;
                // if within 24h and event in future -> fire immediately
                if (!isFiniteMs(msUntil24h) && primaryMs > nowMs) {
                  // fallback: still try to notify once, but be conservative
                  createNotificationDoc(user.uid, {
                    title: "Task within 24 hours",
                    body: `${t.title || "Untitled task"} is within 24 hours.`,
                    taskId,
                    type: "less_than_day",
                  }).catch((err) => console.error("createNotificationDoc error:", err));
                  showBrowserNotification("Task within 24 hours", `${t.title || "Untitled task"} is within 24 hours.`).catch((err) => console.error("showBrowserNotification error:", err));
                  setTaskFlag(user.uid, taskId, "notifiedLessThanDay").catch((err) => console.warn("setTaskFlag error:", err));
                } else if (isFiniteMs(msUntil24h) && msUntil24h <= 0 && primaryMs > nowMs) {
                  // inside 24h window — notify now
                  createNotificationDoc(user.uid, {
                    title: "Task within 24 hours",
                    body: `${t.title || "Untitled task"} is within 24 hours.`,
                    taskId,
                    type: "less_than_day",
                  }).catch((err) => console.error("createNotificationDoc error:", err));
                  showBrowserNotification("Task within 24 hours", `${t.title || "Untitled task"} is within 24 hours.`).catch((err) => console.error("showBrowserNotification error:", err));
                  setTaskFlag(user.uid, taskId, "notifiedLessThanDay").catch((err) => console.warn("setTaskFlag error:", err));
                } else if (isFiniteMs(msUntil24h) && msUntil24h > 0) {
                  scheduleTimer(`${taskId}_lt24h`, msUntil24h, async () => {
                    await createNotificationDoc(user.uid, {
                      title: "Task within 24 hours",
                      body: `${t.title || "Untitled task"} is within 24 hours.`,
                      taskId,
                      type: "less_than_day",
                    }).catch((err) => console.error("createNotificationDoc error:", err));
                    await showBrowserNotification("Task within 24 hours", `${t.title || "Untitled task"} is within 24 hours.`).catch((err) => console.error("showBrowserNotification error:", err));
                    await setTaskFlag(user.uid, taskId, "notifiedLessThanDay").catch((err) => console.warn("setTaskFlag error:", err));
                  });
                } else {
                  // don't schedule for invalid ms
                  console.info(`No 24h timer for ${taskId}. msUntil24h=${msUntil24h}`);
                }
              }
            }

            /* ---------- 5-min before start ---------- */
            if (startMs && !t.notifiedBeforeStart) {
              if (!isFiniteMs(startMs)) {
                console.warn(`Skipping 5min-before-start for ${taskId}: invalid startMs`, startMs);
              } else {
                const msUntilStart5 = startMs - nowMs - 5 * 60 * 1000;
                if (isFiniteMs(msUntilStart5) && msUntilStart5 > 0) {
                  scheduleTimer(`${taskId}_before_start`, msUntilStart5, async () => {
                    await createNotificationDoc(user.uid, {
                      title: "Task starting soon",
                      body: `${t.title || "Untitled task"} starts in 5 minutes.`,
                      taskId,
                      type: "before_start",
                    }).catch((err) => console.error("createNotificationDoc error:", err));
                    await showBrowserNotification("Task starting soon", `${t.title || "Untitled task"} starts in 5 minutes.`).catch((err) => console.error("showBrowserNotification error:", err));
                    await setTaskFlag(user.uid, taskId, "notifiedBeforeStart").catch((err) => console.warn("setTaskFlag error:", err));
                  });
                } else if (isFiniteMs(msUntilStart5) && msUntilStart5 <= 0 && startMs > nowMs) {
                  // within 5-min window now
                  createNotificationDoc(user.uid, {
                    title: "Task starting soon",
                    body: `${t.title || "Untitled task"} starts in 5 minutes.`,
                    taskId,
                    type: "before_start",
                  }).catch((err) => console.error("createNotificationDoc error:", err));
                  showBrowserNotification("Task starting soon", `${t.title || "Untitled task"} starts in 5 minutes.`).catch((err) => console.error("showBrowserNotification error:", err));
                  setTaskFlag(user.uid, taskId, "notifiedBeforeStart").catch((err) => console.warn("setTaskFlag error:", err));
                } else {
                  console.info(`No 5min-start timer for ${taskId}. msUntilStart5=${msUntilStart5}`);
                }
              }
            }

            /* ---------- 5-min before end ---------- */
            if (endMs && !t.notifiedBeforeEnd) {
              if (!isFiniteMs(endMs)) {
                console.warn(`Skipping 5min-before-end for ${taskId}: invalid endMs`, endMs);
              } else {
                const msUntilEnd5 = endMs - nowMs - 5 * 60 * 1000;
                if (isFiniteMs(msUntilEnd5) && msUntilEnd5 > 0) {
                  scheduleTimer(`${taskId}_before_end`, msUntilEnd5, async () => {
                    await createNotificationDoc(user.uid, {
                      title: "Task ending soon",
                      body: `${t.title || "Untitled task"} ends in 5 minutes.`,
                      taskId,
                      type: "before_end",
                    }).catch((err) => console.error("createNotificationDoc error:", err));
                    await showBrowserNotification("Task ending soon", `${t.title || "Untitled task"} ends in 5 minutes.`).catch((err) => console.error("showBrowserNotification error:", err));
                    await setTaskFlag(user.uid, taskId, "notifiedBeforeEnd").catch((err) => console.warn("setTaskFlag error:", err));
                  });
                } else if (isFiniteMs(msUntilEnd5) && msUntilEnd5 <= 0 && endMs > nowMs) {
                  // within 5-min window now
                  createNotificationDoc(user.uid, {
                    title: "Task ending soon",
                    body: `${t.title || "Untitled task"} ends in 5 minutes.`,
                    taskId,
                    type: "before_end",
                  }).catch((err) => console.error("createNotificationDoc error:", err));
                  showBrowserNotification("Task ending soon", `${t.title || "Untitled task"} ends in 5 minutes.`).catch((err) => console.error("showBrowserNotification error:", err));
                  setTaskFlag(user.uid, taskId, "notifiedBeforeEnd").catch((err) => console.warn("setTaskFlag error:", err));
                } else {
                  console.info(`No 5min-end timer for ${taskId}. msUntilEnd5=${msUntilEnd5}`);
                }
              }
            }
          });
        } catch (err) {
          console.error("tasks snapshot processing error:", err);
        }
      },
      (err) => {
        console.error("tasks onSnapshot error:", err);
      }
    );

    unsubTasksRef.current = unsub;

    // cleanup for this effect
    return () => {
      clearAllTimers();
      if (unsubTasksRef.current) {
        try {
          unsubTasksRef.current();
        } catch (err) {
          console.error("unsub tasks cleanup error:", err);
        }
        unsubTasksRef.current = null;
      }
    };
  }, [user, authLoading]);

  // final cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimers();
      if (unsubNotificationsRef.current) {
        try {
          unsubNotificationsRef.current();
        } catch (err) {
          console.error("unsub notifications cleanup error:", err);
        }
        unsubNotificationsRef.current = null;
      }
      if (unsubTasksRef.current) {
        try {
          unsubTasksRef.current();
        } catch (err) {
          console.error("unsub tasks cleanup error:", err);
        }
        unsubTasksRef.current = null;
      }
    };
  }, []);

  // mark as read
  async function markAsRead(id) {
    if (!user || !id) return;
    try {
      await updateDoc(doc(firestore, `users/${user.uid}/notifications/${id}`), { read: true });
    } catch (err) {
      console.error("markAsRead failed:", err);
    }
  }

  // mark all as read
  async function markAllAsRead() {
    if (!user) return;
    try {
      const unread = notifications.filter((n) => !n.read);
      const updates = unread.map((n) =>
        updateDoc(doc(firestore, `users/${user.uid}/notifications/${n.id}`), { read: true })
      );
      await Promise.all(updates);
    } catch (err) {
      console.error("markAllAsRead failed:", err);
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
