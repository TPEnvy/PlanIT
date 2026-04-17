# Plan-It

## Environment

Create `.env` from `.env.example` and provide the Firebase web app values through `VITE_*` variables before running or deploying the client.

Push notifications are enabled by default in the current app. Set `VITE_ENABLE_PUSH_NOTIFICATIONS=false` only if Firebase Cloud Messaging is not configured for your deployed domain yet.

The reminder worker now uses the Resend API for email delivery. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` on the worker service. For testing, `onboarding@resend.dev` only works when sending to the email address tied to your Resend account; for real delivery to other recipients, verify your own sending domain in Resend first.

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
8. `VITE_FIREBASE_VAPID_KEY`
9. `VITE_ENABLE_PUSH_NOTIFICATIONS`

`vercel.json` adds the SPA rewrite Vercel expects for deep links such as `/dashboard` and `/tasks/:id`.

After the first deploy, add the Vercel production and preview domains to Firebase Authentication authorized domains, and complete Firebase Cloud Messaging web push setup for those same domains if you want device notifications on desktop or mobile browsers.

The app now registers FCM tokens only after notification permission is granted. For the stronger desktop/mobile device notifications to work while the app is in the background, make sure your Firebase Web Push certificate key is stored in `VITE_FIREBASE_VAPID_KEY`.

## Railway

Railway should be used for the Python ML API in `ml/ml_local`, not for the Vite frontend root.

Use these service settings:

1. Set the Root Directory to `/ml/ml_local`.
2. Let Railway build from `ml/ml_local/Dockerfile`.
3. Use the default container command from the Dockerfile, which starts `uvicorn` on `$PORT`.

For Railway variables:

1. Set `FIREBASE_SERVICE_ACCOUNT_JSON` as a runtime variable containing the full Firebase service account JSON, or provide `GOOGLE_APPLICATION_CREDENTIALS` to a file that exists at runtime.
2. Do not configure `FIREBASE_SERVICE_ACCOUNT_JSON` as a build secret. The API reads it when the container starts, not while the image is building.
3. Optionally set `FIRESTORE_PROJECT` if you want to force the project id.

The specific Railway error `failed to stat ... /secrets/FIREBASE_SERVICE_ACCOUNT_JSON` means the variable was being mounted into the build as a secret, but no secret file/value was available for that build step.

The API health endpoint is `/health`.

## Google Sign-In

For Google sign-in to work in production, add every deployed domain to Firebase Authentication:

1. Open Firebase Console.
2. Go to Authentication > Settings > Authorized domains.
3. Add your production domain and any preview domains you plan to use.
4. Make sure Google is enabled under Authentication > Sign-in method.
