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

  const sample = await client.query(
    `SELECT objectid,
            CASE WHEN shape IS NOT NULL THEN 'has_shape' ELSE 'null' END AS shape_status
     FROM sde.ecd_mapping_form
     LIMIT 3`,
  );
  console.log('Sample rows:', sample.rows);

  // Try coordinate extraction methods
  const probes = [
    `SELECT sde.st_x(shape) AS x, sde.st_y(shape) AS y FROM sde.ecd_mapping_form WHERE shape IS NOT NULL LIMIT 1`,
    `SELECT ST_X(shape::geometry) AS x, ST_Y(shape::geometry) AS y FROM sde.ecd_mapping_form WHERE shape IS NOT NULL LIMIT 1`,
  ];
  for (const sql of probes) {
    try {
      const r = await client.query(sql);
      console.log('OK:', sql.slice(0, 60), '...', r.rows[0]);
    } catch (e) {
      console.log('FAIL:', sql.slice(0, 60), (e as Error).message);
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
