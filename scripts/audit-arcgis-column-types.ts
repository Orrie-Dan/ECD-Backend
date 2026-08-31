/**
 * Audit public.* vs gis.* columns for ArcGIS Pro compatibility.
 * Flags PostgreSQL enums, uuid, json, and other USER-DEFINED types (except geometry).
 *
 * Usage: npx ts-node scripts/audit-arcgis-column-types.ts
 */

import { Client } from 'pg';
import { loadEnvFile, redactUrl } from './gis-scenario-c-shared';

loadEnvFile();

const ARCGIS_OK_UDT = new Set([
  'text',
  'varchar',
  'bpchar',
  'int2',
  'int4',
  'int8',
  'float4',
  'float8',
  'numeric',
  'bool',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'geometry',
  'geography',
]);

function isArcGisUnsafe(dataType: string, udtName: string): boolean {
  if (dataType === 'USER-DEFINED') {
    return udtName !== 'geometry' && udtName !== 'geography';
  }
  if (dataType === 'ARRAY') return true;
  if (udtName === 'uuid') return true;
  if (dataType === 'json' || dataType === 'jsonb') return true;
  return false;
}

async function auditTable(client: Client, schema: string, name: string) {
  const { rows } = await client.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, name],
  );

  if (rows.length === 0) return null;

  const unsafe = rows.filter((r) => isArcGisUnsafe(r.data_type, r.udt_name));
  return { rows, unsafe };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const client = new Client({ connectionString: url });
  await client.connect();
  console.log(`Target: ${redactUrl(url)}\n`);

  const publicTables = ['ecd_center', 'administrative_unit', 'device'];
  const gisViews = [
    'ecd_center',
    'administrative_unit',
    'compliance_assessment_latest',
    'wash_indicator_latest',
    'child_nutrition_screening',
    'referral',
    'sted_assessment',
  ];

  console.log('=== PUBLIC tables (do NOT register in ArcGIS) ===\n');
  for (const t of publicTables) {
    const result = await auditTable(client, 'public', t);
    if (!result) {
      console.log(`${t}: not found\n`);
      continue;
    }
    console.log(`public.${t} — ${result.unsafe.length} unsafe column(s):`);
    for (const u of result.unsafe) {
      console.log(`  BAD  ${u.column_name} (${u.udt_name})`);
    }
    if (result.unsafe.length === 0) console.log('  (none — unusual)');
    console.log('');
  }

  console.log('=== GIS views (register these in ArcGIS) ===\n');
  let gisFailures = 0;
  for (const v of gisViews) {
    const result = await auditTable(client, 'gis', v);
    if (!result) {
      console.log(`gis.${v}: VIEW NOT FOUND\n`);
      gisFailures += 1;
      continue;
    }
    if (result.unsafe.length > 0) {
      gisFailures += 1;
      console.log(`gis.${v} — FAIL (${result.unsafe.length} unsafe):`);
      for (const u of result.unsafe) {
        console.log(`  BAD  ${u.column_name} (${u.udt_name})`);
      }
    } else {
      console.log(`gis.${v} — OK (${result.rows.length} columns, all ArcGIS-safe)`);
    }
    const oid = result.rows.find((r) => r.column_name === 'objectid');
    if (oid) {
      console.log(`       objectid: ${oid.data_type}/${oid.udt_name}, nullable=${oid.is_nullable}`);
    }
  }

  const nullOid = await client.query<{ n: number }>(
    `SELECT count(*) FILTER (WHERE objectid IS NULL)::int AS n
     FROM ecd_center WHERE deleted_at IS NULL`,
  );
  console.log(`\necd_center rows with NULL objectid: ${nullOid.rows[0].n}`);

  await client.end();
  if (gisFailures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
