import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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
  const c = new Client({ connectionString: url });
  await c.connect();
  const units = await c.query(
    `SELECT level::text AS level, count(*)::int AS n FROM sde.administrative_unit GROUP BY level ORDER BY level`,
  );
  const districts = await c.query(`SELECT count(*)::int AS n FROM sde.district`);
  console.log(JSON.stringify({ units: units.rows, districts: districts.rows[0].n }, null, 2));
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
