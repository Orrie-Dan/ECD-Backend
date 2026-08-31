/**
 * Phase 8 pre-flight — verify gis.* layers are ready for ArcGIS Pro registration.
 *
 * Usage:
 *   npm run gis:verify:phase8
 *   npx ts-node scripts/verify-gis-phase-8.ts --url "postgresql://..."
 *
 * Exit 0 = all checks passed; exit 1 = one or more failures (details printed).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

type CheckResult = { name: string; ok: boolean; detail: string };

const EXPECTED_VIEWS = [
  'ecd_center',
  'administrative_unit',
  'compliance_assessment_latest',
  'wash_indicator_latest',
  'child_nutrition_screening',
  'referral',
  'attendance_summary',
  'sted_assessment',
  'parent_contribution',
  'center_support',
  'classroom_by_center',
  'staff_training_by_center',
  'center_feeding_month_summary',
] as const;

async function main() {
  const urlArg = process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : undefined;
  const url = urlArg ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set (or pass --url)');

  const client = new Client({ connectionString: url });
  await client.connect();

  const results: CheckResult[] = [];

  const push = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok, detail });
    const tag = ok ? 'PASS' : 'FAIL';
    console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // --- PostGIS + schema ---
  const ext = await client.query<{ ext: string }>(
    `SELECT extname AS ext FROM pg_extension WHERE extname = 'postgis'`,
  );
  push('postgis extension', ext.rows.length === 1, ext.rows[0]?.ext ?? 'missing');

  const gisSchema = await client.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'gis'`,
  );
  push('gis schema exists', gisSchema.rowCount === 1, '');

  // --- Expected views ---
  const viewRows = await client.query<{ view_name: string }>(
    `SELECT table_name AS view_name
     FROM information_schema.views
     WHERE table_schema = 'gis'
     ORDER BY table_name`,
  );
  const present = new Set(viewRows.rows.map((r) => r.view_name));
  for (const v of EXPECTED_VIEWS) {
    push(`view gis.${v}`, present.has(v), present.has(v) ? '' : 'not found');
  }

  // --- ArcGIS column type safety (no PostgreSQL enums/uuid/json in gis views) ---
  const arcgisOkUdt = new Set([
    'text', 'varchar', 'bpchar', 'int2', 'int4', 'int8', 'float4', 'float8',
    'numeric', 'bool', 'date', 'time', 'timestamp', 'timestamptz', 'geometry', 'geography',
  ]);
  const isUnsafe = (dataType: string, udtName: string) =>
    dataType === 'USER-DEFINED'
      ? udtName !== 'geometry' && udtName !== 'geography'
      : dataType === 'ARRAY' || udtName === 'uuid' || dataType === 'json' || dataType === 'jsonb';

  for (const v of EXPECTED_VIEWS) {
    if (!present.has(v)) continue;
    const cols = await client.query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'gis' AND table_name = $1`,
      [v],
    );
    const bad = cols.rows.filter(
      (c) => isUnsafe(c.data_type, c.udt_name) || (!arcgisOkUdt.has(c.udt_name) && c.data_type === 'USER-DEFINED'),
    );
    push(
      `ArcGIS types gis.${v}`,
      bad.length === 0,
      bad.length ? bad.map((c) => `${c.column_name}(${c.udt_name})`).join(', ') : '',
    );
  }

  const oidNull = await client.query<{ n: number }>(
    `SELECT count(*) FILTER (WHERE objectid IS NULL)::int AS n FROM ecd_center WHERE deleted_at IS NULL`,
  );
  push('ecd_center objectid NOT NULL', oidNull.rows[0].n === 0, `${oidNull.rows[0].n} null objectid rows`);

  // --- Spatial layers ---
  const centerGeom = await client.query<{ total: number; with_geom: number; srid: number | null }>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE geom IS NOT NULL)::int AS with_geom,
       max(ST_SRID(geom)) AS srid
     FROM ecd_center WHERE deleted_at IS NULL`,
  );
  const cg = centerGeom.rows[0];
  push(
    'ecd_center geom coverage',
    cg.with_geom > 0 && (cg.srid === 4326 || cg.srid === null),
    `${cg.with_geom}/${cg.total} rows, SRID=${cg.srid ?? 'n/a'}`,
  );

  const adminGeom = await client.query<{
    total: number;
    with_geom: number;
    with_latlon: number;
    srid: number | null;
  }>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE geom IS NOT NULL)::int AS with_geom,
       count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS with_latlon,
       max(ST_SRID(geom)) AS srid
     FROM administrative_unit`,
  );
  const ag = adminGeom.rows[0];
  const adminOk =
    ag.with_geom > 0 || (ag.with_latlon === 0 && ag.total > 0);
  push(
    'administrative_unit geom coverage',
    adminOk,
    ag.with_geom > 0
      ? `${ag.with_geom}/${ag.total} rows, SRID=${ag.srid ?? 'n/a'}`
      : `${ag.with_geom}/${ag.total} with geom (${ag.with_latlon} have lat/lon — backfill coords before admin map layer)`,
  );

  // --- objectid (ArcGIS-friendly) ---
  const objectid = await client.query<{ centers: number; admin: number }>(
    `SELECT
       (SELECT count(*)::int FROM ecd_center WHERE objectid IS NOT NULL AND deleted_at IS NULL) AS centers,
       (SELECT count(*)::int FROM administrative_unit WHERE objectid IS NOT NULL) AS admin`,
  );
  push(
    'objectid populated',
    objectid.rows[0].centers > 0 && objectid.rows[0].admin > 0,
    `centers=${objectid.rows[0].centers}, admin=${objectid.rows[0].admin}`,
  );

  // --- Latest views: at most one row per center ---
  for (const [view, col] of [
    ['compliance_assessment_latest', 'center_id'],
    ['wash_indicator_latest', 'center_id'],
  ] as const) {
    const dup = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT ${col} FROM gis.${view} GROUP BY ${col} HAVING count(*) > 1
       ) d`,
    );
    push(`gis.${view} one row per center`, dup.rows[0].n === 0, dup.rows[0].n ? `${dup.rows[0].n} duplicates` : '');
  }

  // --- Relationship FK orphans (destination rows whose center_id missing from live centers) ---
  const orphanChecks: Array<[label: string, sql: string]> = [
    [
      'wash_indicator → center',
      `SELECT count(*)::int AS n FROM wash_indicator w
       LEFT JOIN ecd_center e ON e.id = w.center_id AND e.deleted_at IS NULL
       WHERE w.deleted_at IS NULL AND e.id IS NULL`,
    ],
    [
      'compliance_assessment → center',
      `SELECT count(*)::int AS n FROM compliance_assessment ca
       LEFT JOIN ecd_center e ON e.id = ca.center_id AND e.deleted_at IS NULL
       WHERE ca.deleted_at IS NULL AND e.id IS NULL`,
    ],
    [
      'referral → center',
      `SELECT count(*)::int AS n FROM referral r
       LEFT JOIN ecd_center e ON e.id = r.center_id AND e.deleted_at IS NULL
       WHERE r.deleted_at IS NULL AND e.id IS NULL`,
    ],
    [
      'child_nutrition_screening → child → center',
      `SELECT count(*)::int AS n FROM child_nutrition_screening cns
       JOIN child ch ON ch.id = cns.child_id AND ch.deleted_at IS NULL
       LEFT JOIN ecd_center e ON e.id = ch.center_id AND e.deleted_at IS NULL
       WHERE cns.deleted_at IS NULL AND e.id IS NULL`,
    ],
  ];

  for (const [label, sql] of orphanChecks) {
    const { rows } = await client.query<{ n: number }>(sql);
    push(`FK orphan: ${label}`, rows[0].n === 0, rows[0].n ? `${rows[0].n} orphan rows` : '');
  }

  // --- Referral polymorphic source_id audit (informational warning) ---
  const badReferrals = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM referral r
     WHERE r.deleted_at IS NULL
       AND (
         (r.source_type = 'nutrition' AND NOT EXISTS (
           SELECT 1 FROM child_nutrition_screening s WHERE s.id = r.source_id AND s.deleted_at IS NULL
         ))
         OR (r.source_type = 'sted' AND NOT EXISTS (
           SELECT 1 FROM sted_assessment s WHERE s.id = r.source_id AND s.deleted_at IS NULL
         ))
       )`,
  );
  const refOk = badReferrals.rows[0].n === 0;
  push(
    'referral.source_id polymorphic integrity',
    refOk,
    refOk ? '' : `${badReferrals.rows[0].n} rows with invalid source_id (fix before go-live)`,
  );

  // --- Row counts per gis view (smoke SELECT) ---
  console.log('\n--- gis.* row counts ---');
  for (const v of EXPECTED_VIEWS) {
    if (!present.has(v)) continue;
    try {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM gis.${v}`);
      console.log(`  gis.${v}: ${rows[0].n}`);
    } catch (e) {
      push(`query gis.${v}`, false, String(e));
    }
  }

  await client.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error('\nFailed checks:');
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
