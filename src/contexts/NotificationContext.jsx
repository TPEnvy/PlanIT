import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getMessaging, isSupported, onMessage } from "firebase/messaging";
import app, { firestore } from "../server.js/firebase";
import { useAuth } from "./AuthContext";

const NotificationContext = createContext();
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const enablePushNotifications =
  import.meta.env.VITE_ENABLE_PUSH_NOTIFICATIONS !== "false";

function safeDate(value) {
  if (!value) return null;

  try {
    if (typeof value.toDate === "function") return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function isTaskFinished(task) {
  return (
    task?.finalized === true ||
    task?.status === "completed" ||
    task?.status === "missed" ||
    Number(task?.completedCount || 0) > 0 ||
    Number(task?.missedCount || 0) > 0
  );
}

function buildReminderBody(task, type) {
  const title = task?.title || "Untitled task";

  if (type === "less_than_day") {
    return {
      title: "Task within 24 hours",
      body: `${title} is due within 24 hours.`,
    };
  }

  if (type === "before_start") {
    return {
      title: "Task starting soon",
      body: `${title} starts in 5 minutes.`,
    };
  }

  return {
    title: "Task ending soon",
    body: `${title} ends in 5 minutes.`,
  };
}

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const timersRef = useRef(new Map());

  const clearTimers = () => {
    for (const timeoutId of timersRef.current.values()) {
      clearTimeout(timeoutId);
    }
    timersRef.current.clear();
  };

  const showBrowserNotification = async (title, body) => {
    if (!("Notification" in window)) return;

    try {
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }

      if (Notification.permission === "granted") {
        new Notification(title, { body });
      }
    } catch (err) {
      console.error("Browser notification failed:", err);
    }
  };

  const createNotificationDoc = async (uid, payload) => {
    try {
      await addDoc(collection(firestore, `users/${uid}/notifications`), {
        ...payload,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Creating notification document failed:", err);
    }
  };

  const runReminder = async (uid, taskId, type, flagName) => {
    try {
      const taskRef = doc(firestore, `users/${uid}/tasks/${taskId}`);
      const snap = await getDoc(taskRef);
      if (!snap.exists()) return;

      const latestTask = { id: snap.id, ...snap.data() };
      if (isTaskFinished(latestTask) || latestTask?.[flagName]) return;

      const { title, body } = buildReminderBody(latestTask, type);

      await createNotificationDoc(uid, {
        title,
        body,
        taskId,
        type,
      });
      await showBrowserNotification(title, body);
      await updateDoc(taskRef, { [flagName]: true });
    } catch (err) {
      console.error(`Running reminder failed for ${taskId}:`, err);
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const ref = collection(firestore, `users/${user.uid}/notifications`);
    const notificationsQuery = query(ref, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
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
    if (!enablePushNotifications) {
      return undefined;
    }

    let unsubscribe = () => {};

    const setupForegroundMessaging = async () => {
      const supported = await isSupported().catch(() => false);
      if (!supported) return;

      const messaging = getMessaging(app);
      unsubscribe = onMessage(messaging, (payload) => {
        if (payload?.data?.title) {
          showBrowserNotification(payload.data.title, payload.data.body || "");
        }
      });
    };

    setupForegroundMessaging();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    clearTimers();

    if (!user) {
      return undefined;
    }

    const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
    const unsubscribe = onSnapshot(
      tasksRef,
      (snapshot) => {
        clearTimers();
        const now = Date.now();

        snapshot.docs.forEach((docSnap) => {
          const task = { id: docSnap.id, ...docSnap.data() };
          if (isTaskFinished(task)) return;

          const startAt = safeDate(task.startAt);
          const endAt = safeDate(task.endAt);
          const dueDate = safeDate(task.dueDate);
          const reminderPlans = [
            {
              key: `${task.id}_lt24h`,
              when: (startAt || dueDate || endAt)?.getTime() - ONE_DAY_MS,
              upperBound: (startAt || dueDate || endAt)?.getTime(),
              type: "less_than_day",
              flagName: "notifiedLessThanDay",
            },
            {
              key: `${task.id}_before_start`,
              when: startAt?.getTime() - FIVE_MINUTES_MS,
              upperBound: startAt?.getTime(),
              type: "before_start",
              flagName: "notifiedBeforeStart",
            },
            {
              key: `${task.id}_before_end`,
              when: endAt?.getTime() - FIVE_MINUTES_MS,
              upperBound: endAt?.getTime(),
              type: "before_end",
              flagName: "notifiedBeforeEnd",
            },
          ];

          reminderPlans.forEach((plan) => {
            if (!plan.when || !plan.upperBound) return;
            if (task?.[plan.flagName]) return;
            if (plan.when <= now) return;
            if (plan.upperBound <= now) return;

            const timeoutId = setTimeout(() => {
              timersRef.current.delete(plan.key);
              runReminder(user.uid, task.id, plan.type, plan.flagName);
            }, plan.when - now);

            timersRef.current.set(plan.key, timeoutId);
          });
        });
      },
      (error) => {
        console.error("Task reminder listener error:", error);
      }
    );

    return () => {
      unsubscribe();
      clearTimers();
    };
  }, [user]);

  const markAsRead = async (notificationId) => {
    if (!user || !notificationId) return;

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
    if (!user) return;

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
