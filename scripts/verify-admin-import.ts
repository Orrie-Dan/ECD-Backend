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
  const c = new Client({ connectionString: url });
  await c.connect();

  const rutsiro = await c.query(`SELECT id, name FROM sde.district WHERE name = 'Rutsiro'`);
  const rutsiroId = rutsiro.rows[0]?.id;

  const karambira = await c.query(
    `SELECT id, name, district_id FROM sde.administrative_unit WHERE name = 'Karambira' AND level = 'village'`,
  );

  const rutsiroVillages = rutsiroId
    ? await c.query(
        `SELECT count(*)::int AS n FROM sde.administrative_unit WHERE level = 'village' AND district_id = $1`,
        [rutsiroId],
      )
    : { rows: [{ n: 0 }] };

  const gasabo = await c.query(`SELECT id FROM sde.district WHERE name = 'Gasabo'`);
  const gasaboVillages = gasabo.rows[0]?.id
    ? await c.query(
        `SELECT count(*)::int AS n FROM sde.administrative_unit WHERE level = 'village' AND district_id = $1`,
        [gasabo.rows[0].id],
      )
    : { rows: [{ n: 0 }] };

  console.log(
    JSON.stringify(
      {
        rutsiroDistrictId: rutsiroId,
        rutsiroVillageCount: rutsiroVillages.rows[0].n,
        karambira,
        gasaboVillageCount: gasaboVillages.rows[0].n,
      },
      null,
      2,
    ),
  );

  await c.end();
}

main();
