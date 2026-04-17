import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
} from "firebase/messaging";
import app, {
  firebaseVapidKey,
  firestore,
  isWebPushConfigured,
} from "../server.js/firebase";

const PUSH_INSTALLATION_STORAGE_KEY = "planit_push_installation_id";

function createPushInstallationId() {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `push-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getPushInstallationId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const existingId = window.localStorage.getItem(PUSH_INSTALLATION_STORAGE_KEY);
    if (existingId) {
      return existingId;
    }

    const nextId = createPushInstallationId();
    window.localStorage.setItem(PUSH_INSTALLATION_STORAGE_KEY, nextId);
    return nextId;
  } catch (error) {
    console.warn("Push installation storage unavailable:", error);
    return createPushInstallationId();
  }
}

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

export async function registerPushToken(uid, options = {}) {
  const { forceRefresh = false } = options;

  if (
    !uid ||
    !app ||
    !firestore ||
    !isWebPushConfigured ||
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

    const installationId = getPushInstallationId();
    if (!installationId) {
      return null;
    }

    const messaging = getMessaging(app);
    if (forceRefresh) {
      try {
        await deleteToken(messaging);
      } catch (error) {
        console.warn("Existing push token reset failed:", error);
      }
    }

    const token = await getToken(messaging, {
      vapidKey: firebaseVapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return null;
    }

    const tokensRef = collection(firestore, `users/${uid}/fcmTokens`);
    const tokenDocRef = doc(tokensRef, installationId);
    const existingInstallationDoc = await getDoc(tokenDocRef);
    const existingTokenQuery = query(
      tokensRef,
      where("token", "==", token),
      limit(1)
    );
    const existingTokens = await getDocs(existingTokenQuery);

    if (!existingTokens.empty) {
      await updateDoc(existingTokens.docs[0].ref, {
        installationId,
        permission: Notification.permission,
        updatedAt: serverTimestamp(),
        userAgent: navigator.userAgent,
      });
      console.log("Push token synced:", {
        installationId,
        tokenSuffix: token.slice(-12),
      });
      return token;
    }

    const payload = {
      installationId,
      token,
      permission: Notification.permission,
      userAgent: navigator.userAgent,
      updatedAt: serverTimestamp(),
    };

    if (!existingInstallationDoc.exists()) {
      payload.createdAt = serverTimestamp();
    }

    await setDoc(tokenDocRef, payload, { merge: true });

    console.log(forceRefresh ? "Push token refreshed:" : "Push token synced:", {
      installationId,
      tokenSuffix: token.slice(-12),
    });

    return token;
  } catch (error) {
    console.error("Push token registration failed:", error);
    return null;
  }
}

export async function refreshPushToken(uid) {
  return registerPushToken(uid, { forceRefresh: true });
}
