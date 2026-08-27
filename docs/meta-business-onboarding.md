# Meta Business integration

The platform foundation can be deployed before access to the operator's Meta
Business is granted. Keep outbound delivery disabled until the test checklist
below is complete.

## What is already implemented

- Unified WhatsApp, Messenger, and Instagram conversation inbox, with a separate
  encrypted credential and health state for each channel.
- Lead Ads webhook intake and background retrieval of complete lead fields.
- Exact webhook-body signature verification (`X-Hub-Signature-256`).
- Idempotent webhook storage, so Meta retries cannot duplicate messages/leads.
- AES-256-GCM encryption for access tokens; tokens are never returned to the UI.
- Audited outbound queue with delivery/read/failure status updates and retries.
- Human vs AI attribution, per-business and per-conversation AI kill switches,
  and mandatory review unless a future administrator explicitly selects AUTO.
- Meta's 24-hour reply-window guard for free-form messages. Approved templates
  should be implemented before any business-initiated WhatsApp messaging.

## Environment variables

Configure these only in the backend's secret store (Render), never in Vercel or
frontend variables:

```text
META_WEBHOOK_VERIFY_TOKEN=<random secret used only for webhook verification>
META_APP_SECRET=<secret from the Meta developer app>
META_INSTAGRAM_APP_ID=<Instagram App ID from API setup with Instagram Login>
META_INSTAGRAM_APP_SECRET=<Instagram secret from that same setup page>
META_CREDENTIALS_ENCRYPTION_KEY=<32 random bytes encoded as base64>
META_GRAPH_API_VERSION=<currently approved version, e.g. vXX.X>
META_OUTBOX_WORKER_ENABLED=false
META_OUTBOX_INTERVAL_MS=5000
META_GRAPH_TIMEOUT_MS=15000
RUN_META_MIGRATION_ON_STARTUP=true
```

Generate the encryption key in PowerShell:

```powershell
$metaKeyBytes = New-Object byte[] 32
$metaKeyRng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $metaKeyRng.GetBytes($metaKeyBytes)
  [Convert]::ToBase64String($metaKeyBytes)
} finally {
  $metaKeyRng.Dispose()
}
```

Use a separate random value for `META_WEBHOOK_VERIFY_TOKEN`. Rotation of the
encryption key requires re-encrypting stored tokens; do not replace it casually.

### Instagram Login: deploy the native-token fix

The Instagram token generated in **API setup with Instagram Login → Generate
token** is not a Page token. Select the connection type explicitly in the
platform; changing the selection requires **Salva** before **Verifica**.
Previously verified Page-linked connections retain their Facebook Login mode.
Legacy unverified connections need their mode saved once; verification never
silently switches API families after a failure.

For this installation, add these backend Render variables:

```text
META_INSTAGRAM_APP_ID=1007783208974158
META_INSTAGRAM_APP_SECRET=<copy the hidden Instagram secret from the same Meta setup page>
```

Keep the general Meta App ID `1965478457453791`, `META_APP_SECRET`, webhook verify
token and encryption key unchanged. Never put secrets in frontend variables,
source control, screenshots or chat. Redeploy both backend and frontend. No new
database migration is required by this fix; the existing `006` connection-mode
migration must already be applied (`RUN_META_MIGRATION_ON_STARTUP=true`).

In **Meta Business → Impostazioni → Instagram Direct**:

1. Choose **Instagram Login — token da API Instagram**.
2. Use Instagram Professional Account ID `17841400717570644` for the account
   shown during setup. For a different real business account, use its own ID
   and token together, never the test account's ID.
3. Keep the saved Instagram token if it is still valid. A blank token field on
   reload is deliberate: the encrypted token is not sent back to the browser.
4. Record the actual token expiry from Meta. Dashboard tokens normally last 60
   days from generation, NOT 60 days from saving or verifying in this platform.
5. Confirm that the card shows the separate Instagram App ID and a configured
   secret, then click **Salva → Verifica**.

Native verification calls `graph.instagram.com/<version>/me` and checks the
returned `user_id` against the saved account. It then subscribes to `messages`,
`messaging_postbacks`, and `messaging_seen` and requires `success: true`.
Facebook `/debug_token` is not a prerequisite for this flow. Permissions are
enforced by Meta's account and subscription requests; the application does not
invent an introspected scopes list or an expiry for a manually pasted token.
The Instagram App ID displayed in the card is operator-configured metadata,
not proof of the token's issuing app. Generate the token in that same app and
confirm inbound delivery to this backend before using it with customers.

The shared webhook endpoint accepts the main app signature as before; the
separate Instagram secret can authenticate only payloads whose raw body has
`object: instagram`. It cannot authenticate Page or WhatsApp payloads.

Errors now identify **Configurazione Instagram**, **Account e token Instagram**,
or **Iscrizione webhook Instagram**, plus Meta's code/subcode and trace ID when
available. Verification retries a transient failure once; it never retries
message sends as part of verification, and does not bypass permission or
account errors. Share only that redacted error, not an access token.

### Live acceptance checklist (not implied by ACTIVE)

- In the same Meta app, configure the Instagram webhook callback as
  `https://idromardi-v2.onrender.com/api/meta/webhook` with the existing verify
  token. Enable `messages`, `messaging_postbacks`, and `messaging_seen`.
- Complete Meta's publication, account-role, business-verification and permission
  access requirements for the intended audience. Testing with app-role accounts
  does not establish access for unrelated customers.
- Send a unique test DM from another Instagram account to the connected
  professional account. Confirm it appears once in the Instagram inbox and
  that webhook diagnostics show it processed rather than unmatched.
- Reply from Idromardi within the allowed reply window; confirm delivery on the
  recipient's device. Read it and confirm the read receipt updates in Idromardi.
- Reload the settings and inbox: connection mode, IDs, saved-token indicator and
  messages must persist. Confirm archive/restore does not lose the conversation.
- Enable `META_OUTBOX_WORKER_ENABLED=true` for queued retries. Keep AI OFF until
  the separate AI rollout checks below have been approved.
- Enter/track the token's actual expiry and replace it before expiry. Native
  token refresh is not automated by this fix.

The local regression suite uses mocked Meta responses and tests signature
verification; it is not a live Meta acceptance test. ACTIVE means the technical
account/subscription verification passed, not that Meta approved production use.

References: [Instagram Login account validation](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started),
[Instagram webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks),
[Business Login and token lifetime](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login).

## Steps after the Business invitation arrives

### Public privacy notice

The frontend includes a standalone Italian notice at **/privacy**, with deletion
instructions at **/privacy#cancellazione**. It is static HTML, readable without
JavaScript, login, cookies or a backend request. Login and Meta settings link to
it using ordinary anchors, not the protected SPA router. No CRM route or API
authorization has been relaxed.

After deploying the frontend on the existing production domain, the intended
Meta Privacy Policy URL is:

```text
https://manage.idromardi.it/privacy
```

The alternative Vercel domain serves the same page after its deployment:
`https://idromardi-v2.vercel.app/privacy`. Use the actual public production
domain; do not use a protected preview deployment or localhost. Vercel's project
root should be `frontend` so that `frontend/vercel.json` is loaded. Its explicit
privacy rewrites precede the existing-style SPA fallback; static files keep
filesystem precedence. Direct /privacy, /privacy/ and /privacy/index.html should
all serve the full notice, not the SPA shell.

**Business approval before submitting this URL to Meta:** this is an
implementation-specific draft, not a legal compliance certification. Confirm:

- Controller: **Idromardi l.t.d.**, Sofia legal address and Napoli operating
  address, taken from the existing invoice/proforma templates in
  `backend/src/modules/financialSummary/financialSummary.service.js`.
- Contact: **info@idromardi.it**, already used in invoices. Confirm it is the
  correct monitored mailbox for privacy requests; no separate DPO was invented.
- Scope: Idromardi's own communications and leads, not a substitute for
  condominium-service notices or processing agreements with other controllers.
- Legal bases, actual retention criteria, complete provider list, hosting/backup
  locations, transfer safeguards and any required DPO/representative details.
  The current deployment's provider contracts and data regions were not audited.
- The business must assign someone to handle deletion requests and examine
  linked contacts, leads, raw webhook payloads, outbox content, audit records and
  backups where applicable. Existing message deletion is not full data-subject
  erasure; this change adds neither scheduled purging nor a deletion API.
- Keep AI off until its data flow, providers and notice have been reviewed. The
  notice does not advertise the future assistant as an active feature.

Do not put the deletion-instructions URL in a field requiring a programmatic
callback. Where Meta offers **data deletion instructions**, the anchor URL can
be used; this page does not process signed deletion callbacks.

Verification before publication:

1. Confirm the business-approved wording and both contact/address details.
2. Deploy the frontend; no backend migration or environment change is required.
3. Open /privacy without logging in and inspect its HTML source: the complete
   notice must be present. Check the CSS, navigation and deletion email link.
4. Check that /admin/meta-business and /condomini still redirect to /login when
   unauthenticated, and that authenticated operators can open the notice too.
5. Save the confirmed production URL in Meta's privacy-policy field.

Local checks: `cd frontend`, `npm run build`, `npm run test:privacy`.
Tests use a loopback-only production preview and no live Meta/backend requests.

References:
[Meta Platform Terms, section 4](https://developers.facebook.com/terms#privacypolicy),
[Garante: GDPR guidance](https://www.garanteprivacy.it/documents/10160/0/Guida%2Ball%2Bapplicazione%2Bdel%2BRegolamento%2BUE%2B2016%2B679.pdf/2281f960-a7b2-4c53-a3f1-ad7578f8761d?download=true&version=2.0),
[Vercel rewrite configuration](https://vercel.com/docs/project-configuration/vercel-json).

### Account connection

1. Accept the invitation using a named personal Meta account with MFA. Grant
   only the assets and tasks needed for Pages, WhatsApp accounts, Instagram, and
   lead access; avoid shared administrator accounts.
2. Create or attach a Business-type Meta developer app owned by that Business.
3. Add the required products: Webhooks and the messaging products actually used
   (WhatsApp, Messenger, Instagram), plus Lead Ads retrieval where applicable.
4. Configure the callback as
   `https://idromardi-v2.onrender.com/api/meta/webhook` and enter the same verify
   token stored in the backend.
5. Subscribe the app-level Webhooks products to the required objects and fields:
   `whatsapp_business_account/messages`, `page/messages` (plus delivery/read
   fields), and `instagram/messages`. Use the same callback and verify token.
6. Configure each production channel with its own credential:
   - **WhatsApp:** the production Phone Number ID and a permanent System User
     token with `business_management`, `whatsapp_business_management`, and
     `whatsapp_business_messaging`. Assign the app and WABA to that System User.
   - **Messenger:** the Facebook Page ID and Page access token with
     `business_management`, `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, and
     `pages_read_engagement`; add `leads_retrieval` when Lead Ads are used. The Page administrator must have MESSAGING and
     MODERATE tasks.
   - **Instagram with the linked Facebook Page:**
     the Instagram Professional Account ID and the Page access token for the
     linked Page. The token needs `instagram_basic`, `instagram_manage_messages`,
     and `pages_manage_metadata`. Verification confirms both the Page and linked
     Instagram account, then subscribes the Page to message webhooks.
   - **Instagram Login (also supported):** the Instagram Professional Account
     `user_id` and an Instagram user token with `instagram_business_basic` and
     `instagram_business_manage_messages`. These calls use `graph.instagram.com`.
     Select **Instagram Login** explicitly, save, then verify. The platform uses
     the separate Instagram app configuration described above.
7. Do not paste tokens into chat, source code, logs, screenshots, or frontend
   environment variables. Enter them only in the platform configuration page,
   where they are encrypted and never returned to the browser.
8. In **Amministrazione → Meta Business → Impostazioni**, save the general App
   ID, WABA ID and Graph API version. Then save and verify all three channel
   cards. Verification subscribes the account to the correct webhook fields and
   confirms that the token belongs to the entered account ID.
9. Keep `META_OUTBOX_WORKER_ENABLED=false` while testing inbound webhooks. Use
   Meta's test number/Page/test-lead tools, verify deduplication, and confirm that
   lead contact fields hydrate correctly.
10. Test one inbound and operator-approved outbound reply on every channel,
    delivery updates, an expired
    reply window, token failure, and retry behavior. Once inbound delivery is
    confirmed, set `META_OUTBOX_WORKER_ENABLED=true` and restart the backend so
    queued retries and future approved automation are processed continuously.
    Human replies also request immediate processing from the platform; the
    worker remains required for resilient retries.

Meta App Review may also require a privacy policy URL, data-deletion instructions,
a review screencast, and test credentials. Prepare these before requesting
advanced access.

Instagram tokens generated in the App Dashboard are normally long-lived for 60
days. Record their expiry in the channel card and rotate them before expiry. A
future multi-customer OAuth rollout should exchange and refresh these tokens
automatically; manual encrypted storage is appropriate for the operator's own
single production account.

## AI rollout guardrails

The safe rollout sequence is `OFF → DRAFT → APPROVAL`. Do not use `AUTO` until
the business has approved: allowed intents, prohibited claims, escalation rules,
consent/opt-out handling, retention limits, prompt-injection resistance, maximum
message frequency, WhatsApp template policy, and an immediate human handoff.
Every AI proposal must continue to use `meta_outbound_jobs`; an assistant must
never call the Meta Graph API directly or receive the Meta access token.

## Operational and privacy checklist

- Add retention/deletion periods for message content and lead personal data.
- Record the lawful basis and opt-out state; suppress sends after opt-out.
- Limit the Meta configuration page to ADMIN and daily work to ADMIN/REVIEWER.
- Alert on webhook signature failures, repeated Graph API failures, token expiry,
  unprocessed lead hydration, and growing outbound queues.
- Back up the database and document data-subject access/deletion procedures.
- Rotate a compromised token immediately in Meta and update it through the
  encrypted configuration form.
