import { Client } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
  }
}

loadEnv();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const client = new Client({ connectionString: url.split('?')[0] });
  await client.connect();

  const tables = [
    'lookup_child_status',
    'ecd_center',
    'ecd_mapping_form',
    'user_account',
  ];
  const { rows } = await client.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_name = ANY($1::text[])
     ORDER BY table_schema, table_name`,
    [tables],
  );
  console.log('Tables found:', rows);

  const cols = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, udt_schema || '.' || udt_name AS data_type
     FROM information_schema.columns
     WHERE table_schema = 'sde' AND table_name = 'ecd_mapping_form'
     ORDER BY ordinal_position`,
  );
  console.log('\necd_mapping_form columns:', cols.rows.map((r) => r.column_name).join(', '));

  const enums = await client.query(
    `SELECT n.nspname, t.typname
     FROM pg_type t
     JOIN pg_namespace n ON t.typnamespace = n.oid
     WHERE t.typname IN (
       'ecd_center_status', 'classroom_grade', 'administrative_level', 'record_sync_status'
     )`,
  );
  console.log('\nEnum types:', enums.rows);

  const centerCols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'sde' AND table_name = 'ecd_center'
     ORDER BY ordinal_position`,
  );
  console.log('\necd_center columns:', centerCols.rows.map((r) => r.column_name).join(', '));

  const bridge = await client.query(
    `SELECT column_name, udt_name, data_type FROM information_schema.columns
     WHERE table_schema = 'sde' AND table_name = 'ecd_mapping_form'
       AND column_name IN ('center_id', 'ecd_code', 'sync_status')`,
  );
  console.log('\necd_mapping_form bridge columns:', bridge.rows);

  const idTypes = await client.query(
    `SELECT column_name, udt_name FROM information_schema.columns
     WHERE table_schema = 'sde' AND table_name = 'ecd_center'
       AND column_name IN ('id', 'district_id', 'village_id', 'created_by')`,
  );
  console.log('\necd_center id types:', idTypes.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
