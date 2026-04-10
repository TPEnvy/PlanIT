# Plan-It

## Environment

Create `.env` from `.env.example` and provide the Firebase web app values through `VITE_*` variables before running or deploying the client.

Push notifications are optional. Leave `VITE_ENABLE_PUSH_NOTIFICATIONS=false` unless Firebase Cloud Messaging is fully configured for your deployed domain.

## Google Sign-In

For Google sign-in to work in production, add every deployed domain to Firebase Authentication:

1. Open Firebase Console.
2. Go to Authentication > Settings > Authorized domains.
3. Add your production domain and any preview domains you plan to use.
4. Make sure Google is enabled under Authentication > Sign-in method.

## Firebase Hosting

`firebase.json` includes an SPA rewrite so routes such as `/dashboard` and `/tasks/:id` work after deployment instead of returning a 404 on refresh.
