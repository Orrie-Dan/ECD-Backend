/**
 * Import the full Rwanda admin hierarchy into sde.administrative_unit + sde.district.
 * Source: ECD mobile app rwanda-locations.json (~15k villages).
 *
 * Idempotent — skips rows already present by (level, code) / district.code.
 *
 * Usage:
 *   npm run import:rwanda-admin
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

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

function dbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  return url.split('?')[0];
}

type RwandaLocations = Record<
  string,
  Record<string, Record<string, Record<string, string[]>>>
>;

type AdminRow = {
  id: string;
  level: string;
  code: string;
  name: string;
  parentId: string | null;
  districtId: string | null;
};

type DistrictRow = { id: string; code: string; name: string; provinceId: string };

const PROVINCE_NAMES: Record<string, string> = {
  Kigali: 'City of Kigali',
  East: 'Eastern Province',
  West: 'Western Province',
  North: 'Northern Province',
  South: 'Southern Province',
};

function slug(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function defaultJsonPath(): string {
  return path.resolve(__dirname, '../../ECD/src/data/rwanda-locations.json');
}

async function insertAdminBatch(client: Client, batch: AdminRow[], label: string): Promise<number> {
  if (batch.length === 0) return 0;
  const CHUNK = 800;
  let inserted = 0;
  for (let offset = 0; offset < batch.length; offset += CHUNK) {
    const slice = batch.slice(offset, offset + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let i = 1;
    for (const row of slice) {
      placeholders.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
      );
      values.push(row.id, row.level, row.code, row.name, row.parentId, row.districtId);
    }
    const result = await client.query(
      `INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (level, code) DO NOTHING`,
      values,
    );
    inserted += result.rowCount ?? 0;
    process.stdout.write(`  ${label}: ${Math.min(offset + CHUNK, batch.length)}/${batch.length}\r`);
  }
  if (batch.length > 0) console.log(`  ${label}: inserted ${inserted} new row(s)`);
  return inserted;
}

async function insertDistrictBatch(client: Client, batch: DistrictRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let i = 1;
  for (const row of batch) {
    placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, true)`);
    values.push(row.id, row.provinceId, row.code, row.name);
  }
  const result = await client.query(
    `INSERT INTO sde.district (id, province_id, code, name, is_active)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (code) DO NOTHING`,
    values,
  );
  return result.rowCount ?? 0;
}

function buildHierarchy(data: RwandaLocations, adminCache: Map<string, string>) {
  const provinces: AdminRow[] = [];
  const districts: DistrictRow[] = [];
  const sectors: AdminRow[] = [];
  const cells: AdminRow[] = [];
  const villages: AdminRow[] = [];

  function ensureAdmin(
    level: string,
    code: string,
    name: string,
    parentId: string | null,
    districtId: string | null,
    bucket: AdminRow[],
  ): string {
    const key = `${level}:${code}`;
    const cached = adminCache.get(key);
    if (cached) return cached;
    const id = randomUUID();
    adminCache.set(key, id);
    bucket.push({ id, level, code, name, parentId, districtId });
    return id;
  }

  for (const [provinceKey, districtMap] of Object.entries(data)) {
    const provinceName = PROVINCE_NAMES[provinceKey] ?? provinceKey;
    const provinceCode = slug(provinceName);
    const provinceId = ensureAdmin('province', provinceCode, provinceName, null, null, provinces);

    for (const [districtName, sectorMap] of Object.entries(districtMap)) {
      const districtCode = `${provinceCode}-${slug(districtName)}`;
      let districtId = adminCache.get(`district:${districtCode}`);
      if (!districtId) {
        districtId = randomUUID();
        adminCache.set(`district:${districtCode}`, districtId);
        districts.push({ id: districtId, code: districtCode, name: districtName, provinceId });
      }

      for (const [sectorName, cellMap] of Object.entries(sectorMap)) {
        const sectorCode = `${districtCode}-${slug(sectorName)}`;
        const sectorId = ensureAdmin('sector', sectorCode, sectorName, null, districtId, sectors);

        for (const [cellName, villageNames] of Object.entries(cellMap)) {
          const cellCode = `${sectorCode}-${slug(cellName)}`;
          const cellId = ensureAdmin('cell', cellCode, cellName, sectorId, districtId, cells);

          for (const villageName of villageNames) {
            const villageCode = `${cellCode}-${slug(villageName)}`;
            ensureAdmin('village', villageCode, villageName, cellId, districtId, villages);
          }
        }
      }
    }
  }

  return { provinces, districts, sectors, cells, villages };
}

async function main() {
  const jsonPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultJsonPath();
  if (!fs.existsSync(jsonPath)) {
    console.error(`JSON not found: ${jsonPath}`);
    process.exit(1);
  }

  console.log(`Loading ${jsonPath} …`);
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as RwandaLocations;

  const client = new Client({ connectionString: dbUrl() });
  await client.connect();

  const adminCache = new Map<string, string>();
  const existingAdmin = await client.query<{ id: string; level: string; code: string }>(
    `SELECT id, level::text AS level, code FROM sde.administrative_unit`,
  );
  for (const row of existingAdmin.rows) {
    adminCache.set(`${row.level}:${row.code}`, row.id);
  }

  const existingDistricts = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM sde.district`,
  );
  for (const row of existingDistricts.rows) {
    adminCache.set(`district:${row.code}`, row.id);
  }

  console.log(`Existing cache: ${adminCache.size} keys`);
  console.log('Building hierarchy in memory …');
  const built = buildHierarchy(data, adminCache);
  console.log(
    `To insert — provinces ${built.provinces.length}, districts ${built.districts.length}, ` +
      `sectors ${built.sectors.length}, cells ${built.cells.length}, villages ${built.villages.length}`,
  );

  const t0 = Date.now();
  const stats = { province: 0, district: 0, sector: 0, cell: 0, village: 0 };

  stats.province += await insertAdminBatch(client, built.provinces, 'provinces');
  stats.district += await insertDistrictBatch(client, built.districts);
  console.log(`  districts: inserted ${stats.district} new row(s)`);
  stats.sector += await insertAdminBatch(client, built.sectors, 'sectors');
  stats.cell += await insertAdminBatch(client, built.cells, 'cells');
  stats.village += await insertAdminBatch(client, built.villages, 'villages');

  console.log('Backfilling district_id …');
  await client.query(`
    UPDATE sde.administrative_unit c
    SET district_id = s.district_id
    FROM sde.administrative_unit s
    WHERE c.parent_id = s.id
      AND c.level = 'cell'
      AND c.district_id IS NULL
      AND s.district_id IS NOT NULL
  `);
  await client.query(`
    UPDATE sde.administrative_unit v
    SET district_id = sec.district_id
    FROM sde.administrative_unit c
    JOIN sde.administrative_unit sec ON sec.id = c.parent_id
    WHERE v.parent_id = c.id
      AND v.level = 'village'
      AND v.district_id IS NULL
      AND sec.district_id IS NOT NULL
  `);

  const counts = await client.query<{ level: string; n: string }>(
    `SELECT level::text AS level, count(*)::text AS n
     FROM sde.administrative_unit GROUP BY level ORDER BY level`,
  );
  const districtCount = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM sde.district`);
  await client.end();

  console.log('\nInserted this run:', stats);
  console.log('\nDatabase totals:');
  for (const row of counts.rows) console.log(`  ${row.level}: ${row.n}`);
  console.log(`  districts (table): ${districtCount.rows[0]?.n ?? '0'}`);
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
