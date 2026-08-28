# Meta operations release — 28 August 2026

Status: implemented locally; not deployed by this task. No live messages were
sent and no credentials, Meta assets or Render settings were changed.

## Rollout

1. Back up the database. Deploy the backend and frontend together. The new
   composer sends an idempotency key; an old frontend cannot submit new messages
   to the upgraded backend. Existing queued text messages remain supported.
2. Apply migration **007** with `npm run migrate:meta` from `backend`, or keep
   `RUN_META_MIGRATION_ON_STARTUP=true`. It adds recovery/draft fields, the
   `UNCERTAIN` job state and private attachment storage. Its individual schema
   changes are restart-safe. A database lock serializes concurrent migrations.
   Meta routes return a retryable 503 until startup migration/readiness succeeds.
3. Run `npm run audit:meta` in the backend environment. Require `schema.ready`
   and review missing tables/columns, the request index, uncertain messages,
   token expiry, webhook failures and lead recovery counts. It prints no tokens.
4. For Messenger/Instagram attachments, set `META_PUBLIC_BASE_URL` to the public
   HTTPS **backend origin**, not the frontend. `RENDER_EXTERNAL_URL` is the
   fallback. Existing encryption/signature secrets must remain unchanged.
5. Keep AI **OFF**. Review existing queued messages before enabling
   `META_OUTBOX_WORKER_ENABLED=true`. Once enabled, the worker processes saved
   events, safe retries, lead retrieval and eligible Instagram token renewal.
   Enabling it can send previously queued messages: inspect/cancel unwanted jobs
   in **Attività** first.
6. Run the per-channel acceptance tests below before normal operator use.

Render sleep remains acceptable. No keep-alive, paid-plan change or new external
worker was introduced. Work only runs when the backend is awake. The browser
shows delayed-refresh status and retains text drafts in the current tab.
Notifications are the existing in-platform unread badges, not a new push/email
service for closed browsers. Meta must still deliver/retry a webhook successfully
before the platform can recover it; no promise is made to backfill events never
received by this server.

## Operator workflows

- **Conversazioni:** search by contact name/number/email, filter by channel,
  switch inbox/archive, load older messages, view/download supported attachments.
  Text drafts are separated by user/conversation in session storage; logout
  clears them. Template fields and selected files are not persistent drafts.
- **Attività:** inspect pending/failed/uncertain sends and history; cancel,
  explicitly retry, or approve/reject proposals. Network-loss/HTTP 5xx during
  delivery becomes **Esito da verificare** rather than an automatic resend.
  Check with the recipient before retrying: Meta does not guarantee deduplication
  of two separate delivery requests. Local submission retries use one key.
- **WhatsApp templates:** choose an approved text template, enter its parameters
  and inspect the preview. The server revalidates the template before dispatch.
  Text headers/body and static buttons are supported; media headers, dynamic
  buttons, carousels and other advanced formats are disabled. Create/approve
  templates in WhatsApp Manager. Opt-in evidence is required; revocation blocks
  sends and cancels waiting jobs. Do not infer consent from a lead form or phone
  number without checking what the person actually agreed to.
- **Lead:** inspect captured form fields, notes, status, assigned operator and
  next follow-up date. Retry failed retrieval, or manually process the next lead.
  Follow-up dates are displayed, not scheduled reminders. Opening a WhatsApp
  contact neither sends a message nor automatically records consent.
- **Configurazione:** select an existing integration or create a new one; saved
  IDs, token presence, expiry and diagnostics remain visible. Blank token fields
  preserve the saved secret. Save and then verify after changes. Enable Lead Ads
  on the Messenger card only when that feature and its Meta permissions are ready.
- **Data deletion:** deleting a message removes its active content/attachments
  and matching stored webhook content while retaining its deduplication record.
  The ADMIN contact-erasure action also removes linked conversations, jobs and
  leads and scrubs matching retained webhook objects. The confirmation describes
  its scope. Other channels, backups and copies in Meta are separate; messages
  already delivered to recipients are not unsent. Future new messages can create
  a new contact. The business must approve its retention/deletion process.

## Attachments and credentials

Uploads are limited to **8 MB** (WhatsApp JPG/PNG: **5 MB**). The server also
checks the database packet limit; use a smaller file or provision
`max_allowed_packet` above the upload size plus overhead. This release stores
files in MySQL, not the temporary Render filesystem; include them in capacity and
backup planning. Unsent uploads older than one day are removed by maintenance.

Supported uploads: JPG/PNG/PDF/MP3/OGG/MP4 for WhatsApp/Messenger; JPG/PNG/PDF/MP4
for Instagram. Meta can still reject incompatible codecs. Unsupported received
content or expired Meta download URLs show an explanation. This is not a full
media transcoding, malware-scanning or historical-attachment archive service.

CRM downloads require authentication. Messenger/Instagram receive a per-file
signed URL valid for ten minutes so Meta can fetch the file; uploads are not
permanently public. Tokens stay server-side. Redirects to non-Meta download hosts
are rejected and credentials are not forwarded to arbitrary hosts.

Native Instagram Login renewal uses Meta's refresh endpoint for a valid,
long-lived token at least 24 hours old. Recorded expiry is necessary for automatic
renewal. The worker attempts it within the last seven days, at most once a day
per account. A suspended server cannot renew a token; an expired/revoked token
still requires replacement. Messenger/Page and WhatsApp/System User credentials
are not renewed by the Instagram flow.

## What still requires the business / Meta

### WhatsApp

- Obtain the official number, confirm ownership and whether it needs migration
  or a supported coexistence flow. Do not remove an existing WhatsApp account
  casually. Complete registration/verification, WABA association and billing
  where required in Meta.
- Obtain the actual **Phone Number ID**, **WABA ID**, and a production System User
  credential with the necessary asset assignments and messaging permissions.
  A long-lived credential is still revocable; do not treat it as immortal.
- Create a new integration for the new number, configure **only the new WhatsApp
  channel**, verify it, then suspend the test-number channel. Preserve old
  histories. Leave existing Messenger/Instagram accounts in their original
  integration; do not duplicate them.
- Approve any templates needed outside the customer-service window and confirm
  the business's opt-in procedure.

### Messenger

- Use the real Page ID and a valid Page token belonging to the selected app/Page.
  Complete the app's publication and required permission/access steps for the
  intended audience. Replacing a token must not use an unrelated personal token.
- Verify the channel to subscribe the Page. For Lead Ads, enable lead capture,
  grant the requested lead permissions and assign the CRM/lead access in Meta
  Business settings, then verify again. Messaging success alone does not prove
  lead-form access.

### Instagram

- Use the real professional account with the selected credential mode. Native
  Instagram Login and Facebook Page tokens use different API hosts and cannot be
  interchanged. Keep the separate native Instagram App ID/secret configured.
- Complete the publication, role and access requirements shown by Meta. Access
  requirements depend on whether the app serves owned/managed accounts or other
  businesses; a technical ACTIVE badge is not proof of App Review approval.
- Register the actual token expiry and verify subscriptions. Test with an account
  outside the developer/tester roles to establish the intended production reach.

For all channels, confirm the public privacy/deletion URLs are accessible without
login, the business has approved their content and any required review/business
verification is complete. These settings cannot be approved by local code.

## Acceptance and regression checks

Local automated checks: `npm run check` in `backend`, `npm run build` and
`npm run test:privacy` in `frontend`. The Meta suite covers duplicate submissions,
durable event recovery, receipt order, tombstones/echoes, credential-change races,
uncertain delivery, consent/window rules, signed files and selective erasure.

For visual checks only: `node tests/meta-ui-fixture.mjs` from `frontend`, open the
printed localhost URL and use any dummy login. Its API is simulated and never
forwards requests to Meta or the database. Do not deploy this fixture.

Before real use, apply/test the migration on a database copy, including an
interrupted/repeated upgrade. Then test each real channel: inbound message,
operator reply, actual receipt on a separate device, delivery/read updates,
archive/restore, reload, attachment both ways, expired-window blocking and token
replacement. For WhatsApp also test a parameterized template with consent. For
Lead Ads submit a test form and verify every captured field. Test a restart while
an event/lead is pending and confirm recovery; uncertain sends must stay held for
review. Local mocked tests are not live Meta or MySQL acceptance tests.

References: [Instagram messages and media](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api),
[Instagram token renewal](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login).
