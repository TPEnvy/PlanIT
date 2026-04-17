importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyArsbLJRI9GFgFRph8Upbpy8fNOCFwTd1A",
  authDomain: "planit-f2783.firebaseapp.com",
  projectId: "planit-f2783",
  messagingSenderId: "1016048057274",
  appId: "1:1016048057274:web:6624e5e859785af6a63b83",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("Background message:", payload);

  const title = payload.data.title;
  const options = {
    body: payload.data.body,
  };

  self.registration.showNotification(title, options);
});
