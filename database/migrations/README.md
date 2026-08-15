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
