# Plan-It

## Environment

Create `.env` from `.env.example` and provide the Firebase web app values through `VITE_*` variables before running or deploying the client.

Push notifications are enabled by default in the current app. Set `VITE_ENABLE_PUSH_NOTIFICATIONS=false` only if Firebase Cloud Messaging is not configured for your deployed domain yet.

## Vercel

Vercel can read this app correctly as a Vite SPA.

Add these Environment Variables in the Vercel project settings before deploying:

1. `VITE_FIREBASE_API_KEY`
2. `VITE_FIREBASE_AUTH_DOMAIN`
3. `VITE_FIREBASE_PROJECT_ID`
4. `VITE_FIREBASE_STORAGE_BUCKET`
5. `VITE_FIREBASE_MESSAGING_SENDER_ID`
6. `VITE_FIREBASE_APP_ID`
7. `VITE_FIREBASE_MEASUREMENT_ID`
8. `VITE_ENABLE_PUSH_NOTIFICATIONS`

`vercel.json` adds the SPA rewrite Vercel expects for deep links such as `/dashboard` and `/tasks/:id`.

After the first deploy, add the Vercel production and preview domains to Firebase Authentication authorized domains, and complete Firebase Cloud Messaging web push setup for those same domains if you want device notifications on desktop or mobile browsers.

## Google Sign-In

For Google sign-in to work in production, add every deployed domain to Firebase Authentication:

1. Open Firebase Console.
2. Go to Authentication > Settings > Authorized domains.
3. Add your production domain and any preview domains you plan to use.
4. Make sure Google is enabled under Authentication > Sign-in method.
