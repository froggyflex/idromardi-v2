# Database migrations

Migrations are applied in filename order and must be backed up before execution.

For the mobile-reading vertical slice, apply:

```powershell
mysql -h $env:DB_HOST -u $env:DB_USER -p $env:DB_NAME `
  < database/migrations/001_mobile_readings.sql
```

`001_mobile_readings.sql` is additive. It does not change `letture_righe`; mobile
data remains in staging until an authorized reviewer accepts it transactionally.

For the transitional legacy acconto/storno snapshot fields, then apply:

```powershell
mysql -h $env:DB_HOST -u $env:DB_USER -p $env:DB_NAME `
  < database/migrations/002_storno_transition.sql
```

`002_storno_transition.sql` is idempotent and records the per-user TXT request,
legacy replacement, absorbed shortage, deferred residual, and transition status.

For the unified Meta Business CRM foundation, apply:

```powershell
cd backend
npm run migrate:meta
```

`003_meta_crm_foundation.sql` creates the integration, channel, lead, contact,
conversation, message, webhook inbox, outbound queue, and audit tables. Access
tokens are encrypted by the application; the migration never stores secrets.
The Meta migration runner also applies the tracked `004` archive/deletion update
and `005` per-channel credential and connection-health update exactly once.
