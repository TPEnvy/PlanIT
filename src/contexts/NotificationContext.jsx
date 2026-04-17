import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
} from "firebase/firestore";
import { getMessaging, isSupported, onMessage } from "firebase/messaging";
import app, {
  firestore,
  isWebPushConfigured,
} from "../server.js/firebase";
import { useAuth } from "./AuthContext";
import {
  createUserNotification,
  registerPushToken,
  refreshPushToken,
  requestNotificationPermission,
  showDeviceNotification,
} from "../utils/notifications";

const NotificationContext = createContext();
const MAX_REMINDER_DRIFT_MS = 30000;
const REMINDER_CONFIGS = [
  {
    type: "5m",
    title: "Starting Soon",
    taskField: "startAt",
    flagField: "pushSent5m",
    offsetMs: -300000,
    getBody: (taskTitle) => `"${taskTitle}" starts in 5 minutes`,
  },
  {
    type: "start",
    title: "Task Started",
    taskField: "startAt",
    flagField: "pushSentStart",
    offsetMs: 0,
    getBody: (taskTitle) => `"${taskTitle}" is starting now`,
  },
  {
    type: "before_end",
    title: "Task ending soon",
    taskField: "endAt",
    flagField: "pushSentBeforeEnd",
    offsetMs: -300000,
    getBody: (taskTitle) => `"${taskTitle}" ends in 5 minutes`,
  },
  {
    type: "end",
    title: "Task Ended",
    taskField: "endAt",
    flagField: "pushSentEnd",
    offsetMs: 0,
    getBody: (taskTitle) => `"${taskTitle}" has ended`,
  },
];

function isLegacyDayReminder(notification) {
  const type = String(notification?.type || "").toLowerCase();
  const title = String(notification?.title || "").toLowerCase();
  const body = String(notification?.body || "").toLowerCase();

  return (
    type === "less_than_day" ||
    title.includes("24 hours") ||
    body.includes("24 hours")
  );
}

function normalizeNotificationType(type) {
  if (type === "before_start" || type === "5m") return "5m";
  return type || "unknown";
}

function safeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReminderKey(taskId, type) {
  return `${taskId}:${type}`;
}

function getReminderNotificationId(taskId, type) {
  return `reminder_${taskId}_${type}`;
}

function clearReminderTimers(timersRef) {
  timersRef.current.forEach((timerId) => {
    clearTimeout(timerId);
  });
  timersRef.current.clear();
}

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const reminderTimersRef = useRef(new Map());

  useEffect(() => {
    if (!user || !firestore) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const ref = collection(firestore, `users/${user.uid}/notifications`);
    const notificationsQuery = query(ref, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const uniqueNotifications = new Map();

        snapshot.docs.forEach((docSnap) => {
          const notification = {
            id: docSnap.id,
            ...docSnap.data(),
          };
          if (isLegacyDayReminder(notification)) {
            return;
          }
          const normalizedType = normalizeNotificationType(notification.type);
          const shouldDedupeByTask = Boolean(notification.taskId) &&
            [
              "5m",
              "before_end",
              "start",
              "end",
              "task_completed",
              "task_missed",
            ].includes(normalizedType);
          const dedupeKey = shouldDedupeByTask
            ? `${notification.taskId}|${normalizedType}`
            : notification.id;

          if (!uniqueNotifications.has(dedupeKey)) {
            uniqueNotifications.set(dedupeKey, notification);
          }
        });

        const list = Array.from(uniqueNotifications.values());
        setNotifications(list);
        setLoading(false);
      },
      (error) => {
        console.error("Notification listener error:", error);
        setNotifications([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !firestore) {
      clearReminderTimers(reminderTimersRef);
      return undefined;
    }

    const tasksRef = collection(firestore, `users/${user.uid}/tasks`);

    const unsubscribe = onSnapshot(
      tasksRef,
      (snapshot) => {
        clearReminderTimers(reminderTimersRef);

        snapshot.docs.forEach((docSnap) => {
          const task = docSnap.data() || {};

          if (task.status !== "pending" || task.isSplitParent) {
            return;
          }

          const taskTitle = task.title || "Untitled Task";

          REMINDER_CONFIGS.forEach((config) => {
            if (task[config.flagField]) {
              return;
            }

            const taskDate = safeDate(task[config.taskField]);
            if (!taskDate) {
              return;
            }

            const scheduledAt = taskDate.getTime() + config.offsetMs;
            const delay = scheduledAt - Date.now();

            if (delay <= 0) {
              return;
            }

            const timerKey = getReminderKey(docSnap.id, config.type);
            const taskRef = doc(firestore, `users/${user.uid}/tasks/${docSnap.id}`);
            const timeoutId = window.setTimeout(async () => {
              reminderTimersRef.current.delete(timerKey);

              try {
                const claimed = await runTransaction(
                  firestore,
                  async (transaction) => {
                    const freshSnap = await transaction.get(taskRef);

                    if (!freshSnap.exists()) {
                      return null;
                    }

                    const latestTask = freshSnap.data() || {};
                    if (
                      latestTask.status !== "pending" ||
                      latestTask.isSplitParent ||
                      latestTask[config.flagField]
                    ) {
                      return null;
                    }

                    const latestDate = safeDate(latestTask[config.taskField]);
                    if (!latestDate) {
                      return null;
                    }

                    const latestScheduledAt =
                      latestDate.getTime() + config.offsetMs;
                    const lateByMs = Date.now() - latestScheduledAt;

                    if (lateByMs > MAX_REMINDER_DRIFT_MS) {
                      return null;
                    }

                    transaction.update(taskRef, {
                      [config.flagField]: true,
                    });

                    return latestTask;
                  }
                );

                if (!claimed) {
                  return;
                }

                const latestTitle = claimed.title || taskTitle;
                const body = config.getBody(latestTitle);

                await createUserNotification(user.uid, {
                  title: config.title,
                  body,
                  taskId: docSnap.id,
                  type: config.type,
                  notificationId: getReminderNotificationId(
                    docSnap.id,
                    config.type
                  ),
                });

                await showDeviceNotification(config.title, body, {
                  data: { taskId: docSnap.id, type: config.type },
                  tag: `reminder:${config.type}:${docSnap.id}`,
                });
              } catch (error) {
                console.error(
                  `Failed to send scheduled reminder (${config.type}):`,
                  error
                );
              }
            }, delay);

            reminderTimersRef.current.set(timerKey, timeoutId);
          });
        });
      },
      (error) => {
        console.error("Task reminder listener error:", error);
        clearReminderTimers(reminderTimersRef);
      }
    );

    return () => {
      unsubscribe();
      clearReminderTimers(reminderTimersRef);
    };
  }, [user]);

  useEffect(() => {
    if (!user || !isWebPushConfigured) {
      return undefined;
    }

    let cancelled = false;
    let removeInteractionListeners = () => {};
    let removeResyncListeners = () => {};

    const syncGrantedPushToken = async (forceRefresh = false) => {
      if (
        cancelled ||
        typeof window === "undefined" ||
        !("Notification" in window) ||
        Notification.permission !== "granted"
      ) {
        return;
      }

      if (forceRefresh) {
        await refreshPushToken(user.uid);
        return;
      }

      await registerPushToken(user.uid);
    };

    const syncPushAccess = async () => {
      if (
        typeof window === "undefined" ||
        !("Notification" in window) ||
        cancelled
      ) {
        return;
      }

      if (Notification.permission === "granted") {
        await syncGrantedPushToken(true);
        return;
      }

      if (Notification.permission !== "default") {
        return;
      }

      const handleFirstInteraction = async () => {
        removeInteractionListeners();
        if (cancelled) return;

        const permission = await requestNotificationPermission();
        if (permission === "granted" && !cancelled) {
          await syncGrantedPushToken(true);
        }
      };

      window.addEventListener("pointerdown", handleFirstInteraction, {
        once: true,
      });
      window.addEventListener("keydown", handleFirstInteraction, {
        once: true,
      });

      removeInteractionListeners = () => {
        window.removeEventListener("pointerdown", handleFirstInteraction);
        window.removeEventListener("keydown", handleFirstInteraction);
      };
    };

    if (typeof window !== "undefined") {
      const handleVisibilityOrFocus = async () => {
        if (document.visibilityState === "hidden") {
          return;
        }

        await syncGrantedPushToken(false);
      };

      window.addEventListener("focus", handleVisibilityOrFocus);
      window.addEventListener("online", handleVisibilityOrFocus);
      document.addEventListener("visibilitychange", handleVisibilityOrFocus);

      removeResyncListeners = () => {
        window.removeEventListener("focus", handleVisibilityOrFocus);
        window.removeEventListener("online", handleVisibilityOrFocus);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityOrFocus
        );
      };
    }

    syncPushAccess();

    return () => {
      cancelled = true;
      removeInteractionListeners();
      removeResyncListeners();
    };
  }, [user]);

  useEffect(() => {
    if (!isWebPushConfigured || !app) {
      return undefined;
    }

    let unsubscribe = () => {};

    const setupForegroundMessaging = async () => {
      const supported = await isSupported().catch(() => false);
      if (!supported) return;

      const messaging = getMessaging(app);
      unsubscribe = onMessage(messaging, (payload) => {
        if (
          payload?.data?.title &&
          !isLegacyDayReminder(payload?.data)
        ) {
          showDeviceNotification(payload.data.title, payload.data.body || "");
        }
      });
    };

    setupForegroundMessaging();
    return () => unsubscribe();
  }, []);

  const markAsRead = async (notificationId) => {
    if (!user || !notificationId || !firestore) return;

    try {
      await updateDoc(
        doc(firestore, `users/${user.uid}/notifications/${notificationId}`),
        { read: true }
      );
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const markAllAsRead = async () => {
    if (!user || !firestore) return;

    try {
      const unread = notifications.filter((n) => !n.read);
      await Promise.all(
        unread.map((notification) =>
          updateDoc(
            doc(
              firestore,
              `users/${user.uid}/notifications/${notification.id}`
            ),
            { read: true }
          )
        )
      );
    } catch (err) {
      console.error("Error marking all as read:", err);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        loading,
        unreadCount,
        markAsRead,
        markAllAsRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
