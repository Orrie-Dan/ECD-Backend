# Survey123 → ECD backend sync

Survey123 publishes to **`sde.ecd_mapping_form`** (Enterprise Geodatabase). On insert/update, a Postgres trigger upserts **`sde.ecd_center`**, seeds **3 classrooms**, and writes back **`center_id`** on the survey row.

WASH indicators are **not** synced (capture later in the app).

## Prerequisites

1. Prisma migrations applied: `npm run prisma:migrate:deploy`
2. Survey import user: `npm run seed:admin`
3. Add field **`ecd_code`** (text, unique) to the Survey123 form / `ecd_mapping_form` layer

## Bridge columns (on `sde.ecd_mapping_form`)

| Column | Purpose |
|---|---|
| `ecd_code` | Business key → `ecd_center.code` (required on submit) |
| `center_id` | Set by trigger → `ecd_center.id` (text, same as backend PK) |
| `sync_status` | `pending` / `applied` / `failed` |
| `sync_error` | Last error message |
| `synced_at` | Last sync attempt |

## Field mapping

| Survey field | Backend |
|---|---|
| `ecd_code` | `ecd_center.code` |
| `name_ecd_sercive` | `ecd_center.name` |
| `province_name` … `village_name` | `district_id`, `village_id` (auto upsert admin units) |
| `active_not_active` | `ecd_center.status` |
| `phone_supervisor` | `ecd_center.phone` (cast from integer) |
| `shape` | `latitude` / `longitude` via `sde.st_x` / `sde.st_y` |

Extended survey fields (accreditation, services, etc.) remain on `ecd_mapping_form` only until a future schema extension.

## Import user

Trigger attributes creates/updates to **`survey_sync`** (`user_account.username`).

Env overrides: `SEED_SURVEY_SYNC_USERNAME`, `SEED_SURVEY_SYNC_PASSWORD`, `SEED_SURVEY_SYNC_FULL_NAME`.

Create via: `npm run seed:survey-sync` (raw SQL — use when Prisma seed fails on EGDB enum schema split).

## Retry failed rows

```sql
UPDATE sde.ecd_mapping_form
SET sync_status = 'pending', sync_error = NULL
WHERE objectid = <id>;

SELECT survey.sync_ecd_mapping_form_row(<objectid>);
```

Or edit a mapped field on the row to re-fire the update trigger.

## Manual backfill (existing rows without ecd_code)

```sql
-- Set ecd_code on existing survey rows, then:
SELECT survey.sync_ecd_mapping_form_row(objectid)
FROM sde.ecd_mapping_form
WHERE sync_status IN ('pending', 'failed') AND ecd_code IS NOT NULL;
```

## SQL objects

- Schema: `survey`
- Function: `survey.sync_ecd_mapping_form_row(objectid)`
- Triggers: `trg_ecd_mapping_form_sync_insert`, `trg_ecd_mapping_form_sync_update`

Migration: `prisma/migrations/20260831130000_survey123_ecd_mapping_sync/migration.sql` (+ follow-up fixes for EGDB text UUID columns)

## EGDB note

On Enterprise Geodatabase PostgreSQL, Prisma UUID columns are often stored as **`text`**. The sync functions use text IDs and `sde.st_x` / `sde.st_y` for geometry. Enum types remain in the **`public`** schema while app tables live in **`sde`**.

Survey123 writes **enum columns directly** (e.g. `ecd_center.status`, `classroom.grade`, `administrative_unit.level`). It does not use the removed GIS `sde.lookup_*` tables or `*_id` dual-write columns. API clients should send enum codes (e.g. `"active"`, `"grade_1"`) rather than lookup UUIDs.
