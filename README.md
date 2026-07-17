# Idromardi v2

Idromardi is split into a browser administration platform, an Express/MySQL API,
and an installed Expo application for iOS and Android. The mobile application is
offline-first: readings are stored durably on the device and synchronized into a
review queue when Wi-Fi or mobile data becomes available.

## Repository layout

```text
backend/                    Express API and private photo storage
database/migrations/        Versioned, reviewable schema changes
docs/                       Architecture and API notes
frontend/                   React administration and review UI
mobile/                     Native Expo/React Native operator app
.github/workflows/          GitHub pull-request checks
docker-compose.yml          Local MySQL, API, and browser UI
```

## Mobile-reading workflow

1. An administrator creates a reading session in the existing platform and
   assigns it to an individual `METER_READER` account.
2. The operator downloads the assignment while online. The building, users,
   meter serials, previous values, and context hashes are persisted in SQLite.
3. Readings are captured offline using immutable client UUIDs.
4. The outbox retries the same UUID with exponential backoff. The API treats an
   identical retry as success and rejects reuse of that UUID with changed data.
5. The server stores the candidate as `TO_BE_ACCEPTED`; it does not write it to
   `letture_righe` yet.
6. An `ADMIN` or `REVIEWER` checks the value and context in the browser and
   accepts or rejects it. Acceptance is transactional and protected by the
   existing unique reading constraint.

See [the architecture and safety model](docs/mobile-readings-architecture.md)
and [the mobile API contract](docs/mobile-readings-api.md).

## Local setup

Node.js 22.13 or later is required by Expo SDK 57.

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item mobile/.env.example mobile/.env

Set-Location backend
npm ci
Set-Location ../frontend
npm ci
Set-Location ../mobile
npm ci
```

For a new Docker database, the base dump and mobile migration are loaded in
order automatically:

```powershell
docker compose up --build
```

For an existing database, apply the migration once with a suitably privileged
database account before starting the new API:

```powershell
mysql -h localhost -u YOUR_USER -p miteamx1_fatturazione `
  -e "source database/migrations/001_mobile_readings.sql"
```

Set a long random `AUTH_TOKEN_SECRET` before deployment. A fresh production
database also requires `INITIAL_ADMIN_PASSWORD`; change it after first login.
Mobile meter photos are private: they are kept in `backend/runtime_uploads` locally or in a private R2
bucket, and are served only through an authenticated review endpoint.

## Checks

```powershell
Set-Location backend; npm run check
Set-Location ../frontend; npm run build
Set-Location ../mobile; npm run typecheck; npm run doctor
```

Camera capture and on-device OCR confirmation are the next mobile slice. The
photo transport, checksum, staging, and authenticated review path are already in
place.
