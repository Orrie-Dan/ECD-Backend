import { readFileSync, existsSync } from 'fs';
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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const client = new Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM lookup_ecd_center_status) AS tier1_status_rows,
      (SELECT count(*)::int FROM ecd_center WHERE status_id IS NOT NULL) AS centers_with_status_fk,
      (SELECT count(*)::int FROM ecd_center WHERE geom IS NOT NULL) AS centers_with_geom,
      (SELECT count(*)::int FROM ecd_center WHERE objectid IS NOT NULL) AS centers_with_objectid,
      (SELECT count(*)::int FROM sted_outcome_summary) AS sted_outcome_rows,
      (SELECT count(*)::int FROM information_schema.views WHERE table_schema = 'gis') AS gis_view_count
  `);
  console.log(rows[0]);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
