import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getMessaging, isSupported, onMessage } from "firebase/messaging";
import app, { firestore } from "../server.js/firebase";
import { useAuth } from "./AuthContext";
import {
  registerPushToken,
  requestNotificationPermission,
  showDeviceNotification,
} from "../utils/notifications";

const NotificationContext = createContext();
const enablePushNotifications =
  import.meta.env.VITE_ENABLE_PUSH_NOTIFICATIONS !== "false";

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

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

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
    if (!user || !enablePushNotifications) {
      return undefined;
    }

    let cancelled = false;
    let removeInteractionListeners = () => {};

    const syncPushAccess = async () => {
      if (
        typeof window === "undefined" ||
        !("Notification" in window) ||
        cancelled
      ) {
        return;
      }

      if (Notification.permission === "granted") {
        await registerPushToken(user.uid);
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
          await registerPushToken(user.uid);
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

    syncPushAccess();

    return () => {
      cancelled = true;
      removeInteractionListeners();
    };
  }, [user]);

  useEffect(() => {
    if (!enablePushNotifications || !app) {
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
