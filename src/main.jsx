import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { isWebPushConfigured } from "./server.js/firebase";
import "./index.css";

function getMessagingServiceWorkerUrl() {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "firebase-messaging-sw.js",
    `${window.location.origin}${normalizedBaseUrl}`
  ).toString();
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

if (isWebPushConfigured && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const serviceWorkerUrl = getMessagingServiceWorkerUrl();
    const isValidServiceWorker = await verifyMessagingServiceWorker(
      serviceWorkerUrl
    );

    if (!isValidServiceWorker) {
      return;
    }

    navigator.serviceWorker
      .register(serviceWorkerUrl)
      .then((registration) => {
        console.log("Service Worker registered:", registration);
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  });
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
