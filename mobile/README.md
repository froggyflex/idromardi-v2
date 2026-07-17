# Idromardi Letture mobile

Installed iOS/Android application for offline meter-reading rounds. SQLite is
authoritative on the device until the server acknowledges each immutable client
submission UUID.

## Bootstrap

Expo SDK 57 requires Node.js 22.13 or newer.

```powershell
Copy-Item .env.example .env
npm install
npx expo install --fix
npx expo install expo-dev-client expo-sqlite expo-secure-store expo-crypto expo-status-bar
npm run typecheck
npm run android
```

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
