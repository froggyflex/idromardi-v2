# Mobile readings API

All routes below are under `/api`, accept a bearer token, and return JSON unless
noted otherwise.

| Method | Route | Roles | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/users` | ADMIN | Create a named operator or reviewer |
| `GET` | `/auth/users` | ADMIN | List assignable users |
| `POST` | `/mobile-readings/assignments` | ADMIN, REVIEWER | Snapshot a session for an operator |
| `GET` | `/mobile-readings/assignments` | ADMIN, METER_READER | List permitted assignments |
| `GET` | `/mobile-readings/catalog` | ADMIN, METER_READER | List active condominiums for a period |
| `POST` | `/mobile-readings/workspace/prepare` | ADMIN, METER_READER | Prepare and download a day's condominium packages |
| `GET` | `/mobile-readings/assignments/:id` | ADMIN, METER_READER | Download the offline package |
| `POST` | `/mobile-readings/submissions` | ADMIN, METER_READER | Idempotently stage a capture |
| `POST` | `/mobile-readings/submissions/:id/photo` | ADMIN, METER_READER | Upload a checksum-bound photo |
| `POST` | `/mobile-readings/sync/status` | ADMIN, METER_READER | Reconcile device UUIDs after uncertain responses |
| `GET` | `/mobile-readings/review` | ADMIN, REVIEWER | List staged candidates |
| `POST` | `/mobile-readings/review/:id/accept` | ADMIN, REVIEWER | Transactionally insert the final reading |
| `POST` | `/mobile-readings/review/:id/reject` | ADMIN, REVIEWER | Reject with an audit note |
| `GET` | `/mobile-readings/review/:id/photo` | ADMIN, REVIEWER | Stream a private image |

## Important responses

- Replaying an identical submission UUID returns success with
  `idempotentReplay: true`.
- A package downloaded after a rejection contains only rejected or outstanding
  items. Items with a current non-rejected submission are omitted.
- `SUBMISSION_MISMATCH` means a UUID was reused with different content and must
  be investigated, not automatically retried with a new UUID.
- `CONTEXT_CHANGED` and `SESSION_CLOSED` retain the candidate as
  `CONTEXT_CONFLICT` for review.
- `READING_ALREADY_EXISTS` requires the reviewer to inspect the current value.
  Replacement occurs only when the accept request explicitly contains
  `{ "replaceExisting": true }`.
- Photo requests must be multipart field `photo` and may include
  `X-Photo-Sha256`. The maximum size is 10 MB.

The migration in `database/migrations/001_mobile_readings.sql` is the canonical
schema contract for assignment, candidate, and event fields.
