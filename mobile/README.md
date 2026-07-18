# Idromardi Letture mobile

Installed iOS/Android application for offline meter-reading rounds. SQLite is
authoritative on the device until the server acknowledges each immutable client
submission UUID.

## Bootstrap

The physical-device test build currently uses Expo SDK 54 for compatibility
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

## Current vertical slice

- Operator authentication and securely stored bearer token
- Assignment download and durable offline SQLite storage
- Manual readings with immutable UUIDs
- Single-flight outbox synchronization with safe retries/backoff
- Server-status reconciliation
- Logout protection while readings are unsynchronized

The photo upload protocol is implemented in the API/sync layer and backend.
Camera capture and on-device ML Kit OCR are the next mobile UI slice.
