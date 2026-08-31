# Scenario C — Implementation Plan

Answers used: Q1 all layers export · Q2 STED mapped geographically = yes ·
Q3 parent contributions/support mapped = yes · Q4 multilingual labels = no

## Resolved decisions (Q5, Q6, Q7)

These were open in the draft plan. Defaults below match the current schema and
privacy posture. Override before Phase 4 if product requirements differ.

| # | Question | **Decision** | Rationale |
|---|----------|--------------|-----------|
| **Q5** | Is `classroom` / `staff_training` location tied to the center's point, or does it need its own coordinates? | **Inherit center geometry.** No new lat/lon columns. Phase 6 views join `ecd_center.geom` only. | Neither table has coordinate fields today; both are keyed by `center_id`. |
| **Q6** | Does `child` ship as its own point/attribute layer? | **No standalone child layer.** Enrollment appears only through aggregated views (`gis.attendance_summary`, `gis.child_nutrition_screening`) and optional center-level rollups. | Avoids exposing PII (names, guardian phone, national ID) on a map product without a separate data-protection sign-off. |
| **Q7** | Native PostGIS `geometry` columns, or lat/lon only with `ST_MakePoint` in views? | **Yes — native PostGIS** on `ecd_center` and `administrative_unit` (Phase 4). Triggers keep `geom` in sync with lat/lon. | Scenario C target; enables proper feature classes and spatial indexes in ArcGIS Pro. |

### Deferred views (Q5/Q6)

- `gis.classroom` — join `classroom` → `ecd_center` for grade counts by center (no child PII)
- `gis.staff_training` — join → `ecd_center` for training counts by center
- No `gis.child` point layer

## Phased sequence

Each phase is independently deployable with its own rollback point (see SQL file footer).
Do not run Phase 5 without validating STED JSON against production samples — backfill SQL
uses keys from `src/modules/sted/mappers/sted.mapper.ts`.

| Phase | Work | Hours | Depends on |
|-------|------|-------|------------|
| 0 | Enable PostGIS, create `gis` schema | 1 | — |
| 1 | Tier 1 lookup tables (10) + seed data | 6 | — |
| 1b | Tier 2 lookup tables (8) + seed data | 5 | — |
| 1c | Optional/coded-string lookups (7) + seed from DISTINCT | 5 | Run `phase-1c-seed-coded-lookups.sql` against target DB |
| 2 | Add `*_id` FK columns, backfill from enums (non-breaking) | 10 | Phase 1/1b/1c |
| 3 | Decimal precision fixes (coords + measurements) | 4 | — |
| 4 | Native geometry columns, triggers, objectid | 6 | Q7 confirmed ✓ |
| 5 | STED JSON flatten: schema + backfill + QA | 20 | Sample STED rows |
| 6 | GIS export views (11 views) | 10 | Phases 1–4 |
| 7 | NestJS DTO/service dual-write to `*_id` | 16 | Phase 2 |
| 8 | ArcGIS Pro registration, symbology QA, sync regression | 10 | Phase 6, 7 |
| — | classroom / staff_training rollup views (Q5) | 2 | Phase 6 ✓ |
| **Total** | | **69–89 h** | |

## Phase 8 — ArcGIS Pro (runbook)

1. Apply SQL: `npm run gis:migrate:phase -- --phase 8` (feeding view)
2. Pre-flight: `npm run gis:verify:phase8`
3. Follow `docs/gis/phases/phase-8-arcgis-registration.md`
4. Relationship inventory: `docs/gis/scenario-c-relationship-map.md`
5. Sync regression: `npm run test:gis:sync-regression`

## Deployment order (staging → production)

1. **Phases 0–3** — fully additive, zero app-code changes. Deploy and verify no
   constraint failures (especially Phase 3 precision narrowing).
2. **Phase 4** — additive; lat/lon-reading code unaffected.
3. **Phase 7** — dual-write enum + `*_id` before mobile cutover.
4. **Phase 5** — backfill STED tables; dual-write JSON + flattened rows one release.
5. **Phase 6** — build `gis.*` views after Phase 2 + 4 backfill complete.
6. **Phase 8** — ArcGIS QA.
7. **Cutover** — drop old enum columns in a separate destructive migration after
   ≥1 release with no regressions.

## One-shot deploy (hosted DB / partial runs)

Use **`npm run gis:deploy`** when the database may already have some phases applied
(e.g. Neon after an interrupted `--through 8`). The deploy script runs phases 0–8
statement-by-statement and skips safe "already exists" errors, then runs
`gis:verify:phase8` unless `--no-verify` is passed.

```bash
# Prerequisite: base Prisma schema
npm run prisma:migrate:deploy

# Full GIS Scenario C (idempotent)
npm run gis:deploy

# Custom URL or skip verification
npm run gis:deploy -- --url "postgresql://..."
npm run gis:deploy -- --no-verify
```

For explicit single-phase runs (fail-fast), use `gis:migrate:phase` below.

## Running Phases 0–3 locally / staging

```bash
# From repo root; uses DATABASE_URL from .env unless --url is passed
npm run gis:migrate:phase -- --phase 0
npm run gis:migrate:phase -- --phase 1
npm run gis:migrate:phase -- --phase 1b
npm run gis:migrate:phase -- --phase 1c
npm run gis:migrate:phase -- --phase 1c-seed   # DISTINCT backfill for coded strings
npm run gis:migrate:phase -- --phase 2
npm run gis:migrate:phase -- --phase 3

# Or all of 0–3 in order:
npm run gis:migrate:phase -- --through 3
```

SQL sources live in `docs/gis/phases/`.

## What's explicitly out of scope

`user_account`, `password_reset_token`, `device`, `sync_session`, `sync_operation`,
`audit_log`, `notification`, `app_setting`, `classroom_assignment_history`,
`ecd_committee_member`, `center_visit`, `parenting_session`.

## Risk notes

- **Mobile sync** — Phase 7 dual-write is mandatory; do not cut over reads until clients ship.
- **STED flatten (Phase 5)** — highest uncertainty; keys aligned to `sted.mapper.ts` but prod samples still required.
- **Phase 3** — run pre-check in `phase-3-decimal-precision.sql` before ALTER.
