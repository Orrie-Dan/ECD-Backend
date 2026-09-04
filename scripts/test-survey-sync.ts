/**
 * Smoke-test Survey123 sync: sets ecd_code on one mapping row and runs sync.
 *
 * Usage:
 *   npx ts-node scripts/test-survey-sync.ts [objectid]
 */

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
  const objectid = parseInt(process.argv[2] ?? '401', 10);
  const url = process.env.DATABASE_URL?.split('?')[0];
  if (!url) throw new Error('DATABASE_URL missing');

  const client = new Client({ connectionString: url });
  await client.connect();

  const code = `ECD-TEST-${objectid}`;
  await client.query(
    `UPDATE sde.ecd_mapping_form
     SET ecd_code = $1, sync_status = 'pending', sync_error = NULL
     WHERE objectid = $2`,
    [code, objectid],
  );

  await client.query(`SELECT survey.sync_ecd_mapping_form_row($1)`, [objectid]);

  const mapping = await client.query(
    `SELECT objectid, ecd_code, center_id, sync_status, sync_error, synced_at
     FROM sde.ecd_mapping_form WHERE objectid = $1`,
    [objectid],
  );
  console.log('Mapping row:', mapping.rows[0]);

  if (mapping.rows[0]?.center_id) {
    const center = await client.query(
      `SELECT id, code, name, district_id, village_id, latitude, longitude, status
       FROM sde.ecd_center WHERE id = $1`,
      [mapping.rows[0].center_id],
    );
    console.log('Center:', center.rows[0]);

    const classrooms = await client.query(
      `SELECT grade FROM sde.classroom WHERE center_id = $1 ORDER BY grade`,
      [mapping.rows[0].center_id],
    );
    console.log('Classrooms:', classrooms.rows.map((r) => r.grade));
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
