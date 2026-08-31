# Phase 8 — ArcGIS Pro registration & QA

Prerequisites: Phases 0–7 applied on the target database; `npm run gis:verify:phase8` passes.

---

## 1. Apply Phase 8 SQL (feeding view)

Adds `gis.center_feeding_month_summary` for the `rel_center_feeding` relationship class.

```bash
npm run gis:migrate:phase -- --phase 8
npm run gis:verify:phase8
```

---

## 2. Database connection in ArcGIS Pro

1. **Catalog** → **Databases** → **New Database Connection**
2. Platform: **PostgreSQL**
3. Connection: host, port, database, user (read-only role recommended for map services)
4. **Authentication:** database auth or IAM per your deployment
5. Expand connection → **`gis` schema** → confirm 14 views listed (13 map layers + optional `device_registry` table)

> **Do not register `public.ecd_center`, `public.administrative_unit`, or `public.device`.**
> Those tables contain PostgreSQL ENUM types (`ecd_center_status`, `device_status`, etc.) that ArcGIS Pro rejects.
> Always use the matching `gis.*` view instead.

**Read-only role (recommended):**

```sql
CREATE ROLE gis_reader LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA gis TO gis_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA gis TO gis_reader;
-- If relating to public.district:
GRANT SELECT ON district TO gis_reader;
```

---

## 3. Add layers to the map

| Layer | Source | Geometry |
|---|---|---|
| ECD Centers | `gis.ecd_center` | Point (EPSG:4326) |
| Administrative units | `gis.administrative_unit` | Point (EPSG:4326) |
| Related tables | `gis.*` views (see relationship map) | None (attributes only) |

1. Drag `gis.ecd_center` onto the map → confirm points draw in Rwanda extent.
2. Set **coordinate system** of the map to **WGS 1984** (EPSG:4326) if prompted.
3. Symbolize centers by `status` or `current_compliance_level` (unique values).

---

## 3b. Troubleshooting — “layer failed” or unknown field types

Run on the backend repo (uses `DATABASE_URL`):

```bash
npm run gis:audit:arcgis-types
npm run gis:migrate:phase -- --phase 9   # ArcGIS-hardened views + objectid NOT NULL
npm run gis:verify:phase8
```

| If you added… | Result | Use instead |
|---|---|---|
| `public.ecd_center` | **Fails** — columns `status`, `sync_status`, `*_id` use PostgreSQL ENUM/UUID | `gis.ecd_center` |
| `public.administrative_unit` | **Fails** — column `level` is ENUM | `gis.administrative_unit` |
| `public.device` | **Fails** — column `status` is `device_status` ENUM; no geometry | `gis.device_registry` (table only, optional) |
| `gis.ecd_center` | **Works** — text labels, integer objectid, PostGIS geom | Set ObjectID field = `objectid`, shape = `geom` |

Esri requires third-party PostGIS tables/views to have:

- exactly one geometry column (`geom`)
- no user-defined ENUM columns in the layer
- a unique integer `objectid` column

Phase 9 SQL recreates all `gis.*` views with explicit `CAST(... AS ...)` (ArcGIS-safe types).

**Symbology QA checklist:**

- [ ] Centers with null geom are excluded from the view (soft-delete filter)
- [ ] Status / compliance labels come from lookup `label_en` columns (not raw enum codes)
- [ ] Boolean fields in views are `smallint` 0/1 — use integer symbology or label expressions
- [ ] Pop-up shows: code, name, status, compliance level, assessed date
- [ ] Identify tool returns related records when relationship classes are built

---

## 4. Create relationship classes

Use **Create Relationship Class** (Geoprocessing) or run
`docs/gis/arcgis/register-scenario-c.py` in ArcGIS Pro's Python window (edit `GDB` path first).

Parameters for each relate (see `docs/gis/scenario-c-relationship-map.md`):

- **Relationship Type:** Simple
- **Forward label:** e.g. "Nutrition screenings"
- **Backward label:** e.g. "Center"
- **Cardinality:** One-to-many (or one-to-one for `_latest` views)
- **Message direction:** Forward (origin → destination)
- **Origin primary key:** `id`
- **Destination foreign key:** `center_id` (or `parent_id` / `province_id` / `village_id` for admin)

**Order of operations:**

1. Register origin feature classes (`gis.ecd_center`, `gis.administrative_unit`) in a file geodatabase *or* use the database connection directly in a map (relationship classes in EGDB require importing layers to GDB — for Query Layers, relates work in the map document without a GDB copy).
2. Add destination tables from the same connection.
3. Create relationship classes per the map doc.
4. Test **Identify → Related Records** on a center point.

> **Note:** If your deployment uses **ArcGIS Enterprise** map services, publish from the map after relates are validated locally. Use a dedicated `gis_reader` DB user with SELECT-only grants.

---

## 5. Optional — full-history views

If pop-ups need all compliance assessments (not just latest), run:

```sql
CREATE OR REPLACE VIEW gis.compliance_assessment_full AS
SELECT ca.id, ca.center_id, e.geom,
  at.label_en AS assessment_type,
  ast.label_en AS status,
  oc.label_en AS overall_classification,
  ca.assessment_date
FROM compliance_assessment ca
JOIN ecd_center e ON e.id = ca.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_assessment_type at ON at.id = ca.assessment_type_id
LEFT JOIN lookup_assessment_status ast ON ast.id = ca.status_id
LEFT JOIN lookup_compliance_classification oc ON oc.id = ca.overall_classification_id
WHERE ca.deleted_at IS NULL;
```

Replace `rel_center_compliance` destination with `gis.compliance_assessment_full` (1:M).

---

## 6. Sync regression (Phase 7 dual-write)

After GIS registration, confirm mobile/REST paths still dual-write lookup FKs:

```powershell
npm run test:gis:sync-regression
```

Or individually: `npm run test:sync-apply-attendance`, `test:sync-apply-feeding`, `test:referrals`, `test:sted`, `test:nutrition`.

---

## 7. Sign-off checklist

- [ ] `npm run gis:verify:phase8` — all checks green
- [ ] Both spatial layers draw correctly
- [ ] All 11 center-related relationship classes identify records
- [ ] Admin hierarchy self-relate + district + centers work
- [ ] Symbology uses lookup labels, not Prisma enum strings
- [ ] Sync regression tests pass
- [ ] `referral.source_id` audit clean (or split-column migration scheduled)

---

## Rollback

```sql
DROP VIEW IF EXISTS gis.center_feeding_month_summary;
```

Relationship classes are map/GDB metadata — delete in ArcGIS Pro if needed. No OLTP rollback required.
