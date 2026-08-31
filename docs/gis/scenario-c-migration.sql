-- ============================================================================
-- Scenario C — Full Spatial Refactor (master reference)
-- ECD Backend → ArcGIS Pro compatibility
-- ============================================================================
-- Prefer running numbered files in docs/gis/phases/ via:
--   npm run gis:migrate:phase -- --through 3
--
-- This file concatenates all phases for review/diff. Do not run blindly as
-- one transaction in production.
-- ============================================================================

\i docs/gis/phases/phase-0-prerequisites.sql
\i docs/gis/phases/phase-1-tier1-lookups.sql
\i docs/gis/phases/phase-1b-tier2-lookups.sql
\i docs/gis/phases/phase-1c-optional-lookups.sql
\i docs/gis/phases/phase-1c-seed-coded-lookups.sql
\i docs/gis/phases/phase-2-fk-columns.sql
\i docs/gis/phases/phase-3-decimal-precision.sql
\i docs/gis/phases/phase-4-postgis-geometry.sql
\i docs/gis/phases/phase-5-sted-flatten.sql
\i docs/gis/phases/phase-6-gis-views.sql
\i docs/gis/phases/phase-8-feeding-view.sql

-- Note: \i requires psql. The npm runner executes each phase file directly.
-- Phase 8 ArcGIS registration (manual): docs/gis/phases/phase-8-arcgis-registration.md
