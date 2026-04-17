import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import {
  firebaseVapidKey,
  isPushNotificationsEnabled,
  isWebPushConfigured,
} from "./server.js/firebase";
import "./index.css";

function getMessagingServiceWorkerUrl() {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "firebase-messaging-sw.js",
    `${window.location.origin}${normalizedBaseUrl}`
  ).toString();
}

function getMessagingServiceWorkerScope() {
  const baseUrl = import.meta.env.BASE_URL || "/";
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

async function verifyMessagingServiceWorker(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    const isJavaScriptResponse = /(java|ecma)script/i.test(contentType);

    if (!response.ok || !isJavaScriptResponse) {
      console.warn(
        `Skipping messaging service worker registration because ${url} returned "${contentType || "unknown"}".`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Unable to verify messaging service worker asset:", error);
    return false;
  }
}

async function registerMessagingServiceWorker() {
  if (!isWebPushConfigured) {
    if (isPushNotificationsEnabled && !firebaseVapidKey) {
      console.warn(
        "Web push is enabled, but VITE_FIREBASE_VAPID_KEY is missing."
      );
    }
    return;
  }

  if (!("serviceWorker" in navigator)) {
    console.warn("Service workers are unavailable in this browser.");
    return;
  }

  const serviceWorkerUrl = getMessagingServiceWorkerUrl();
  const serviceWorkerScope = getMessagingServiceWorkerScope();
  const isValidServiceWorker = await verifyMessagingServiceWorker(
    serviceWorkerUrl
  );

  if (!isValidServiceWorker) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      serviceWorkerUrl,
      {
        scope: serviceWorkerScope,
        updateViaCache: "none",
      }
    );
    console.log("Service Worker registered:", {
      scope: registration.scope,
      url: serviceWorkerUrl,
    });
  } catch (error) {
    console.error("Service Worker registration failed:", error);
  }
}

if (typeof window !== "undefined") {
  if (document.readyState === "complete") {
    registerMessagingServiceWorker();
  } else {
    window.addEventListener("load", registerMessagingServiceWorker, {
      once: true,
    });
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </AuthProvider>
  </React.StrictMode>
);
