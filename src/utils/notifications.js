import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { firestore } from "../server.js/firebase";

export async function showDeviceNotification(title, body) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }

    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch (error) {
    console.error("Device notification failed:", error);
  }
}

export async function createUserNotification(uid, payload) {
  if (!uid || !firestore) return null;

  try {
    return await addDoc(collection(firestore, `users/${uid}/notifications`), {
      ...payload,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Creating notification document failed:", error);
    return null;
  }
}
