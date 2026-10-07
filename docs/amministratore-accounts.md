# Amministratore accounts

Operator admins manage accounts at `/admin/amministratori` (sidebar: Account
amministratori). Create an account with a unique username, a temporary password
of at least eight characters, and zero or more condominium assignments. Deliver
those credentials directly to the amministratore. An account without assignments
has an empty portal. Assignments can be changed at any time and take effect on
the next request, including during an active support session.

An `AMMINISTRATORE` must replace the temporary password with a different password
before viewing any portal data. The server enforces this requirement. Changing
the password invalidates earlier tokens, issues a replacement session, and makes
the temporary credentials unusable. Passwords are stored using the existing
salted PBKDF2 scheme. No shared master password is provided.

The portal at `/amministratore` lists only assigned, undeleted condomini and
archived `prospetto`, `prospetto_bw`, `bollette_complete`, and individual legacy
bolletta PDFs. It exposes building identity fields and saved PDFs only. It never
generates documents or exposes accounting edits, imported supplier documents,
issued invoices, readings, contacts, search, CRM, or operator tools. Every PDF
request validates both the assignment and the document's actual condominium.
Client query filters cannot widen its scope. Existing archive/storage availability
still governs whether a saved PDF can be opened.
The document area opens on the latest billing period, with separate prospetto
and bollette cards, year and period filters, in-portal PDF preview, and direct
downloads. Saved color/monochrome variants, individual bills, and prior versions
remain accessible. Period identity comes from the associated billing session or
saved archive metadata; generation dates are not used as billing periods.
Documents lacking period metadata are shown in **Altri documenti**. PDF preview
uses the browser's viewer, with download/new-tab actions available when inline
viewing is unsupported.
Legacy non-image `/uploads` files also require operator authentication; public
building images and logos remain embeddable. An old raw PDF URL cannot bypass
the portal's assignment checks. Operator requests to raw files must supply their
normal bearer token (or the existing `authToken` query mechanism).

An `ADMIN` can choose **Accedi come amministratore**. This issues a one-hour token
for the target account with the operator identity and audit-session ID attached.
It also works before the target's initial password change, solely for read-only
support. The portal displays a persistent assistance banner and a **Torna
all’account operatore** button. The support session cannot change passwords,
modify data, manage assignments, or start further impersonation sessions.

`app_auth_impersonations` records the operator, target, start, expiry, and explicit
return time. Returning ends that support token and restores the operator's own
session. Leaving via logout or closing the browser lets the session expire at
its recorded time. Changing either account's password invalidates active support
tokens. Operator role and token version are rechecked on every support request.

## Deployment and checks

The auth service applies the additive schema on first authenticated use and
caches successful initialization per process. For deployments with restricted
database permissions, apply `database/migrations/010_amministratore_accounts.sql`
after the existing auth/mobile migration before starting the new API. Both the
backend and frontend must be updated together, since password changes now return
a replacement token. The migration does not create amministratore accounts or
change existing passwords. Schema changes have not been applied to a production
database by this code change.

For an application-managed migration using the backend environment:

```powershell
cd backend
npm run migrate:amministratori
```

This command also ensures the default operator account, following the existing
`INITIAL_ADMIN_PASSWORD` rules for a fresh production database.

```powershell
cd backend
npm run test:auth
cd ../frontend
npm run build
npm run test:amministratori-ui
```

Access tests exercise the actual Express middleware and handlers with an isolated
database fixture. Browser tests exercise account creation, assignment editing,
first-login enforcement, the restricted portal, and entering/exiting assistance.
Document checks cover period/year filtering, PDF actions, monochrome variants,
individual bills, prior versions, empty/failure states, and mobile overflow.
They do not connect to a live database or modify production accounts.
