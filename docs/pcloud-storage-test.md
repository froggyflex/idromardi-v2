# pCloud Europe storage test

This is the first stage of evaluating the operator's Ultra 10 TB lifetime account.
Both the hosted test screen and standalone runner connect to `https://eapi.pcloud.com`, upload synthetic
bolletta and prospetto PDFs and verifies both preview and download retrieval.
It does not connect to the platform database, modify production storage settings,
migrate existing files or introduce pCloud links in the amministratore portal.
Amministratore portal access and production migration are a later stage after this live probe passes.

## Hosted setup on Render and Vercel (preferred)

The frontend adds an admin-only **Impostazioni → Test archivio pCloud** page at
`/admin/pcloud-test`. Deploy the backend and frontend changes through the
existing repository connections before using the page.

1. Submit the app request in [pCloud My Apps](https://docs.pcloud.com/my_apps/)
   with website `https://idromardi-v2.vercel.app`, application type `Other`,
   write access `Yes`, folder access `All folders` and one connected user.
   Wait for pCloud approval and the app's Client ID and Client Secret.
2. In Render, open the existing backend service, then **Environment**, and add:

   | Key | Value |
   | --- | --- |
   | `PCLOUD_CLIENT_ID` | The approved app's Client ID |
   | `PCLOUD_CLIENT_SECRET` | The approved app's Client Secret |
   | `PCLOUD_TEST_BACKEND_URL` | `https://idromardi-v2.onrender.com` |
   | `PCLOUD_TEST_FRONTEND_URL` | `https://idromardi-v2.vercel.app` |

   Save and deploy. Keep the existing R2 and database settings. The backend URL
   falls back to Render's `RENDER_EXTERNAL_URL` when no explicit override is set.
3. In the approved pCloud app, register this exact redirect URI:
   `https://idromardi-v2.onrender.com/api/pcloud-test/callback`.
   Use the HTTPS Render address, not the frontend URL or the local callback.
4. On Vercel, deploy the updated frontend. No pCloud credentials or new pCloud
   environment variables belong on Vercel. The existing `VITE_API_URL` continues
   to point to `https://idromardi-v2.onrender.com/api`.
5. Log into the development platform as an ADMIN. Open **Test archivio pCloud**,
   select **Collega pCloud e avvia test**, sign into pCloud and approve access.
   The callback returns to the Vercel page while Render uploads and verifies
   both synthetic PDFs. **Visualizza** opens each verified downloaded PDF and
   **Scarica** saves it on the operator's computer.

The hosted probe stores its session, results and verified PDF buffers only in
backend memory, for 15 minutes from starting the test. A backend restart,
redeployment or expired session requires starting again. Use one Render instance
for this test; sessions are not shared between replicas. Only the authenticated
admin who started a test can retrieve its results and PDFs. No database migration
or new backend disk is required. OAuth tokens are not persisted, logged or sent to
Vercel. The test is not a permanent pCloud storage connection.

Moving to `https://manage.idromardi.it` later means updating
`PCLOUD_TEST_FRONTEND_URL` (and the pCloud app's website). The callback stays on
Render unless the backend's public address changes.

## Standalone local setup (alternative)

1. The operator signs in to [pCloud My Apps](https://docs.pcloud.com/my_apps/)
   and registers an OAuth app named `Idromardi storage test`.
2. Register the redirect URI exactly as `http://127.0.0.1:43821/pcloud/callback`.
   The browser used for authorisation must be on the same computer as the runner.
3. Configure `PCLOUD_CLIENT_ID` and `PCLOUD_CLIENT_SECRET` in `backend/.env`.
   This file is ignored by Git. Do not paste secrets into chat or commit them.
   The operator's pCloud password is never needed by the runner.
4. From `backend`, run `npm run test:pcloud-live`.
5. Open the printed pCloud authorisation URL in a browser on that computer.
   Sign in to the European account and approve the app.

The callback listens only on `127.0.0.1`, checks the session's random OAuth state,
rejects a non-European account and consumes a valid callback once. Authorisation
must complete within ten minutes. If port 43821 is occupied, change
`PCLOUD_TEST_PORT` and the registered redirect URI to the same new port.

The OAuth grant is access to the account, not a folder-scoped grant. This runner
only uses it for account quota and its own test files. It holds the access token
in process memory and does not print or persist it. The registered app remains
authorised in pCloud until the operator revokes it in their account settings.

## What the runner verifies

- Actual total, used and available storage returned by pCloud.
- Creation or reuse of a folder called `Idromardi-test` in the account root.
- Upload of one synthetic bolletta and one synthetic prospetto, each with a
  unique filename. No existing file is overwritten or deleted.
- Retrieval through authenticated `getfilelink` for inline PDF and attachment
  download. Links are used server-side, without public sharing or forwarding
  the OAuth token to a content host. Each operation has a timeout.
- Exact byte comparison against the uploaded PDFs and successful PDF parsing.
- Upload, preview retrieval and download timing for each document.

The test PDFs remain in pCloud for inspection. Verified downloaded copies and a
`report.json` are written to `backend/runtime_uploads/pcloud-test/<run-id>/`.
These outputs are ignored by Git and contain no tokens, app secrets, email address
or download URLs. Open the downloaded PDFs to check their appearance.

The report only describes this small test. It does not measure production
concurrency, large fascicoli, rendering in the amministratore portal or the
account's traffic allowances. The hosted version measures retrieval from Render.
Verify actual traffic
allowances in pCloud account settings before production use; older lifetime
accounts may differ from currently advertised plans.

## Local verification without an account

Run `npm run test:pcloud` from `backend`. These tests mock pCloud responses and
check OAuth state/region enforcement, replay and timeout handling, secret-free
errors, content-host validation, upload conflict protection, and exact PDF
verification. They do not contact pCloud.

Build the frontend and run `npm run test:pcloud-ui` from `frontend` to verify the
hosted screen with mocked responses, including disabled setup, consent navigation,
progress polling, preview/download actions, errors, admin access and mobile layout.

## API references

- [OAuth authorisation](https://docs.pcloud.com/methods/oauth_2.0/authorize.html)
- [Code exchange](https://docs.pcloud.com/methods/oauth_2.0/oauth2_token.html)
- [Global access_token parameter](https://docs.pcloud.com/methods/intro/global_parameters.html)
- [Upload file](https://docs.pcloud.com/methods/file/uploadfile.html)
- [Authenticated file retrieval](https://docs.pcloud.com/methods/streaming/getfilelink.html)
- [Create or reuse folder](https://docs.pcloud.com/methods/folder/createfolderifnotexists.html)
- [Account quota](https://docs.pcloud.com/methods/general/userinfo.html)
