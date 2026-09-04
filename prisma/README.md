# Prisma migrations

## Rules of thumb

| Environment | Command | Notes |
|-------------|---------|--------|
| Local development | `npx prisma migrate dev --name <change>` | Creates a new migration from `schema.prisma` changes, applies it to your local DB, and regenerates the client. |
| CI / staging / production | `npx prisma migrate deploy` | Applies any pending migrations already committed under `prisma/migrations`. **Never** run `migrate dev` or `db push` against shared environments. |

Do **not** use `npx prisma db push` outside disposable local experiments. It bypasses the migration history and causes drift that `migrate deploy` cannot safely reconcile.

## Typical local workflow

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name <short_description>` (e.g. `add_child_notes`).
3. Review the generated SQL under `prisma/migrations/<timestamp>_<name>/migration.sql`.
4. Commit both the schema change and the new migration folder.
5. Deploy with `npx prisma migrate deploy` in CI/production.

## Checking status and drift

```bash
# Are migrations applied?
npx prisma migrate status

# Does the migration history match schema.prisma? (empty = no drift)
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL"
```

Exit code with `--exit-code`: `0` empty, `2` drift, `1` error.

## Baseline / existing databases

If a database was previously created with `db push` and has no `_prisma_migrations` history:

1. Generate (or obtain) the `init` migration that matches the current schema.
2. If the DB **already** has the full schema and data, mark the baseline as applied without re-running SQL:
   `npx prisma migrate resolve --applied <migration_folder_name>`
3. If the DB is empty, use `npx prisma migrate deploy` as usual.

Never run a full `CREATE TABLE` init migration against a database that already contains those tables unless you intend to recreate them (data loss).

## Enterprise Geodatabase (PostgreSQL + `sde` schema)

When app tables live in **`sde`** but PostgreSQL enums live in **`public`**:

- `schema.prisma` uses `schemas = ["sde", "public"]`, `@@schema("sde")` on models, `@@schema("public")` on enums.
- **`DATABASE_URL` must not include `?schema=sde`** (multi-schema mode sets this in the schema file).
- After pulling schema changes: stop the dev server, run `npx prisma generate`, then restart.

Seeding uses raw SQL with `public.*` enum casts (`npm run seed:admin`). Survey123 sync SQL is under `docs/survey123-sync.md`.

## Enum values vs GIS lookup tables (Scenario C cleanup)

PostgreSQL enums in the **`public`** schema are the **single source of truth** for fixed values (center status, classroom grade, administrative level, child gender, etc.). The former GIS Scenario C architecture duplicated each enum with an `sde.lookup_*` table and a parallel `*_id` UUID column on business tables; that dual-write layer has been **removed**.

- **API clients** send enum **codes** (e.g. `"status": "active"`, `"grade": "grade_1"`) — not lookup UUIDs.
- **Survey123** sync writes enum columns directly (`ecd_center.status`, `classroom.grade`, `administrative_unit.level`); it never depended on lookup tables.
- **Historical migrations** under `prisma/migrations/` that created lookup tables must **not** be edited; cleanup is in `20260902120000_remove_scenario_c_lookup_dual_write`.
- Coded string fields without enums (`meal_quality`, `food_source`, `water_source_type`) remain plain text columns only.
