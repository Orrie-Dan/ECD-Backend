# Survey123 → ECD backend sync

Survey123 publishes to **`sde.ecd_mapping_form`** (Enterprise Geodatabase). On insert/update, a Postgres trigger upserts **`sde.ecd_center`**, seeds **3 classrooms**, and writes back **`center_id`** on the survey row.

WASH indicators are **not** synced (capture later in the app).

## Prerequisites

1. Prisma migrations applied: `npm run prisma:migrate:deploy`
2. Survey import user: `npm run seed:admin`
3. MINALOC codes loaded: `npm run import:minaloc-codes -- --apply` (see `data/minaloc/README.md`).
   New facilities can only be coded in villages that carry a MINALOC code.

## Bridge columns (on `sde.ecd_mapping_form`)

| Column | Purpose |
|---|---|
| `ecd_code` | Optional. Used only to find an existing center (by `code`, then `legacy_code`) when the row has no `center_id` yet |
| `center_id` | Set by trigger → `ecd_center.id` (text, same as backend PK). Primary match key once set |
| `ncda_code` | Written by the backend: the center's NCDA code (`PPDDSSCCVV/T/YYYY/NN`). Never typed by surveyors |
| `sync_status` | `pending` / `applied` / `failed` |
| `sync_error` | Last error message |
| `synced_at` | Last sync attempt |

## Field mapping

| Survey field | Backend |
|---|---|
| `ecd_code` | `ecd_center.legacy_code` on a new center, when it is not NCDA-format and unused |
| `start_year_ecd` | `ecd_center.start_year` (year part; required for a new center) |
| `name_ecd_sercive` | `ecd_center.name` |
| `province_name` … `village_name` | `district_id`, `village_id` (auto upsert admin units) |
| `active_not_active` | `ecd_center.status` |
| `phone_supervisor` | `ecd_center.phone` (cast from integer) |
| `shape` | `latitude` / `longitude` via `sde.st_x` / `sde.st_y` |
| `settings_types` | `ecd_center.ncda_type_code` + `facility_type` (deterministic map only; unknown → leave unchanged) |

**`settings_types` → `facility_type` (ALIGN-05A):**

| Survey value | NCDA letter | Canonical |
|---|---|---|
| `Home based ECD`, `Home Based ECD` | B | `home_based` |
| `Community based ECD centre`, `Community Based ECD` | C | `community_based` |
| `School based ECD Centre`, `School Based ECD` | D | `ecd_3_5` |
| `Model ECD centre`, `Model ECD` | E | `ecd_3_5` |

Unmapped: `Centre Based`, `Faith-based`, `Market based`, `Mobile crèches`, `ECD in emergency settings`, `Cross-border ECD`, `ECD in prison`, blank. No survey value maps to A (daycare).

## NCDA facility codes

Codes follow the NCDA guideline (24.9.2024): `PPDDSSCCVV/T/YYYY/NN` — village MINALOC code,
type letter, start year, and a per-village number that is never reused. They are issued only by
`survey.issue_ecd_code`, shared by this trigger, `POST /api/v1/centers` and offline sync.

- **New facility** (no matching center): needs a mapped `settings_types`, `start_year_ecd`, and a
  village with a MINALOC code. Otherwise the row is marked `failed` with the reason and **no center
  is created** — fix the row and retry.
- **Existing facility**: matched by `center_id`, then `ecd_code` against `code`, then `legacy_code`.
  Edits never change the code (a database trigger rejects code changes).
- Re-coding existing centers: `npm run recode:ecd-centers` (dry run → review CSV → `-- --apply`).
- Corrections to an issued code: NCDA admin only, `POST /api/v1/centers/:id/code-override`.

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

## Manual backfill

```sql
SELECT survey.sync_ecd_mapping_form_row(objectid)
FROM sde.ecd_mapping_form
WHERE sync_status IN ('pending', 'failed');
```

## SQL objects

- Schema: `survey`
- Function: `survey.sync_ecd_mapping_form_row(objectid)`
- Coding: `survey.issue_ecd_code`, `survey.recode_ecd_center`, `survey.override_ecd_code`
- Triggers: `trg_ecd_mapping_form_sync_insert`, `trg_ecd_mapping_form_sync_update`,
  `trg_ecd_center_code_insert` / `trg_ecd_center_code_update` (code immutability),
  `trg_ecd_center_code_to_mapping_form` (keeps `ncda_code` current)

Migrations: `20260831130000_survey123_ecd_mapping_sync` (+ follow-up fixes for EGDB text UUID columns),
`20261021120000_minaloc_codes`, `20261021130000_ecd_facility_coding`, `20261021140000_survey_ecd_code_generation`.

## EGDB note

On Enterprise Geodatabase PostgreSQL, Prisma UUID columns are often stored as **`text`**. The sync functions use text IDs and `sde.st_x` / `sde.st_y` for geometry. Enum types remain in the **`public`** schema while app tables live in **`sde`**.

Survey123 writes **enum columns directly** (e.g. `ecd_center.status`, `classroom.grade`, `administrative_unit.level`). It does not use the removed GIS `sde.lookup_*` tables or `*_id` dual-write columns. API clients should send enum codes (e.g. `"active"`, `"grade_1"`) rather than lookup UUIDs.
