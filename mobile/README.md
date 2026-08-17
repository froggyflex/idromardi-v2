# Idromardi Letture mobile

Installed iOS/Android application for offline meter-reading rounds. SQLite is
authoritative on the device until the server acknowledges each immutable client
submission UUID.

## Bootstrap

The physical-device test build currently uses Expo SDK 57 for compatibility
with the Expo Go version distributed through the mobile stores. Node.js 22 is
recommended for this repository.

```powershell
Copy-Item .env.example .env
npm install
npx expo install --check
npm run typecheck
npm run android
```

Set `EXPO_PUBLIC_API_URL` in `.env` to the backend URL including `/api`.

## Try it with Expo Go

Install Expo Go on the phone, keep the phone and this computer on the same Wi-Fi,
then run:

```powershell
npm run start:go
```

Scan the QR code with Expo Go on Android, or with the Camera app on iOS. If QR
discovery is unavailable, enter the `exp://<computer-ip>:8081` address shown by
Expo manually.

The regular `npm start` command is reserved for a custom development client.

For iOS, use EAS Build or a macOS machine with Xcode:

```powershell
npx eas-cli@latest build --profile development --platform ios
```

## Installable builds

The preview profile connects to `https://idromardi-v2.onrender.com/api` and
produces standalone builds that do not require the Expo development server.

```powershell
# Directly installable Android APK
npm run build:android:apk

# Directly installable iOS IPA (registered devices only)
npx eas-cli@latest device:create
npm run build:ios:internal

# Production iOS build uploaded to TestFlight
npm run build:ios:testflight
```

The first build asks you to sign in to Expo and initialize/link the EAS project.
Android signing can be managed by EAS. Physical iOS builds require a paid Apple
Developer account. Internal iOS builds only install on devices registered in
the ad-hoc provisioning profile; TestFlight is the preferred route for a wider
operator rollout.

## Current vertical slice

- Operator authentication and securely stored bearer token
- Assignment download and durable offline SQLite storage
- Daily overview with condominium and meter progress
- Locally editable manual readings with immutable submission UUIDs
- Explicit, single-flight outbox synchronization with safe retries
- Server-status reconciliation
- Transactional local cleanup after a complete condominium is acknowledged
- Logout protection while readings are unsynchronized

The photo upload protocol is implemented in the API/sync layer and backend.
Camera capture and on-device ML Kit OCR are the next mobile UI slice.
