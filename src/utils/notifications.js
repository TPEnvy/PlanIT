import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import app, { firestore } from "../server.js/firebase";

const firebaseVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const defaultNotificationOptions = {
  badge: "/vite.svg",
  icon: "/vite.svg",
  requireInteraction: true,
  renotify: true,
  silent: false,
  vibrate: [200, 100, 200],
};

export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  try {
    if (Notification.permission === "default") {
      return await Notification.requestPermission();
    }

    return Notification.permission;
  } catch (error) {
    console.error("Notification permission request failed:", error);
    return Notification.permission;
  }
}

async function getNotificationRegistration() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) return registration;
    return await navigator.serviceWorker.ready;
  } catch (error) {
    console.error("Notification service worker lookup failed:", error);
    return null;
  }
}

export async function showDeviceNotification(title, body, options = {}) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  try {
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      return false;
    }

    const notificationOptions = {
      ...defaultNotificationOptions,
      body,
      data: options.data || {},
      tag: options.tag || `${title}:${body}`,
      timestamp: Date.now(),
      ...options,
    };

    const registration = await getNotificationRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, notificationOptions);
      return true;
    }

    new Notification(title, notificationOptions);
    return true;
  } catch (error) {
    console.error("Device notification failed:", error);
    return false;
  }
}

export async function createUserNotification(uid, payload) {
  if (!uid || !firestore) return null;

  const notificationsRef = collection(firestore, `users/${uid}/notifications`);
  const notificationPayload = {
    ...payload,
    read: false,
    createdAt: serverTimestamp(),
  };

  delete notificationPayload.notificationId;

  try {
    if (payload?.notificationId) {
      const notificationRef = doc(notificationsRef, payload.notificationId);
      await setDoc(notificationRef, notificationPayload);
      return notificationRef;
    }

    return await addDoc(notificationsRef, notificationPayload);
  } catch (error) {
    console.error("Creating notification document failed:", error);
    return null;
  }
}

export async function registerPushToken(uid) {
  if (
    !uid ||
    !app ||
    !firestore ||
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }

  if (Notification.permission !== "granted") {
    return null;
  }

  if (!firebaseVapidKey) {
    console.warn(
      "VITE_FIREBASE_VAPID_KEY is missing. Skipping push token registration."
    );
    return null;
  }

  const supported = await isSupported().catch(() => false);
  if (!supported) {
    return null;
  }

  try {
    const registration = await getNotificationRegistration();
    if (!registration) {
      return null;
    }

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: firebaseVapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return null;
    }

    const tokensRef = collection(firestore, `users/${uid}/fcmTokens`);
    const existingTokenQuery = query(
      tokensRef,
      where("token", "==", token),
      limit(1)
    );
    const existingTokens = await getDocs(existingTokenQuery);

    if (!existingTokens.empty) {
      await updateDoc(existingTokens.docs[0].ref, {
        permission: Notification.permission,
        updatedAt: serverTimestamp(),
        userAgent: navigator.userAgent,
      });
      return token;
    }

    await addDoc(tokensRef, {
      token,
      permission: Notification.permission,
      userAgent: navigator.userAgent,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return token;
  } catch (error) {
    console.error("Push token registration failed:", error);
    return null;
  }
}
