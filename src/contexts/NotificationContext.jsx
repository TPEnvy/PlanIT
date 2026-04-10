import React, { createContext, useContext, useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getMessaging, isSupported, onMessage } from "firebase/messaging";
import app, {
  firestore,
  isPushNotificationsEnabled,
} from "../server.js/firebase";
import { useAuth } from "./AuthContext";

const NotificationContext = createContext();

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

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
    if (!isPushNotificationsEnabled || !("Notification" in window)) {
      return undefined;
    }

    let unsubscribe = () => {};

    const setupMessaging = async () => {
      const supported = await isSupported().catch(() => false);

      if (!supported) {
        return;
      }

      const messaging = getMessaging(app);
      unsubscribe = onMessage(messaging, (payload) => {
        console.log("Foreground message received:", payload);

        if (Notification.permission === "granted" && payload?.data?.title) {
          new Notification(payload.data.title, {
            body: payload.data.body,
          });
        }
      });
    };

    setupMessaging();

    return () => unsubscribe();
  }, []);

  const markAsRead = async (notificationId) => {
    if (!user || !notificationId) return;

    try {
      const ref = doc(
        firestore,
        `users/${user.uid}/notifications/${notificationId}`
      );

      await updateDoc(ref, {
        read: true,
      });
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;

    try {
      const unread = notifications.filter((n) => !n.read);

      await Promise.all(
        unread.map((n) =>
          updateDoc(
            doc(firestore, `users/${user.uid}/notifications/${n.id}`),
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
