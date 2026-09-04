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
  const url = process.env.DATABASE_URL?.split('?')[0];
  if (!url) throw new Error('DATABASE_URL missing');
  const client = new Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query(
    `SELECT objectid, name_ecd_sercive, province_name, district_name, sector_name, cell_name, village_name, sync_status
     FROM sde.ecd_mapping_form ORDER BY objectid`,
  );
  console.table(rows);
  await client.end();
}

main();
