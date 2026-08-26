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
META_CREDENTIALS_ENCRYPTION_KEY=<32 random bytes encoded as base64>
META_GRAPH_API_VERSION=<currently approved version, e.g. vXX.X>
META_OUTBOX_WORKER_ENABLED=false
META_OUTBOX_INTERVAL_MS=5000
META_GRAPH_TIMEOUT_MS=15000
RUN_META_MIGRATION_ON_STARTUP=true
```

Generate the encryption key in PowerShell:

```powershell
[Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

Use a separate random value for `META_WEBHOOK_VERIFY_TOKEN`. Rotation of the
encryption key requires re-encrypting stored tokens; do not replace it casually.

## Steps after the Business invitation arrives

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
   - **Instagram with the linked Facebook Page (the current Idromardi setup):**
     the Instagram Professional Account ID and the Page access token for the
     linked Page. The token needs `instagram_basic`, `instagram_manage_messages`,
     and `pages_manage_metadata`. Verification confirms both the Page and linked
     Instagram account, then subscribes the Page to message webhooks.
   - **Instagram Login (also supported):** the Instagram Professional Account
     `user_id` and an Instagram user token with `instagram_business_basic` and
     `instagram_business_manage_messages`. These calls use `graph.instagram.com`.
     The platform detects and stores the model during verification.
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
