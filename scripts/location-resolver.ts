/**
 * Step 1: Location hierarchy resolver
 *
 * Reads the ECD survey CSV and ensures every province/district/sector/cell/
 * village it references exists in `administrative_unit` (+ `district`),
 * without relying on the CSV's own district_id/sector_id/cell_id/village_id
 * columns (which are ArcGIS export artifacts, not reliable UUIDs).
 *
 * Codes are generated deterministically from the full name path, so the
 * same location always resolves to the same code, and two same-named cells
 * in different districts never collide.
 *
 * Idempotent: safe to re-run. Existing rows are looked up, not duplicated.
 *
 * Usage:
 *   npm install pg csv-parse
 *   DATABASE_URL=postgres://user:pass@host/db npx ts-node location-resolver.ts path/to/survey.csv
 *
 * Output:
 *   resolved-locations.json — maps each row's ecd_code to { village_id, district_id },
 *   which step 2 (center import) will consume directly.
 */

import { Client } from 'pg';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

function slug(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Treat ArcGIS-style "NULL" / "N/A" placeholders as missing. */
function cleanName(raw: string | undefined): string {
  const v = (raw || '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower === 'null' || lower === 'n/a' || lower === 'na' || lower === 'undefined') return '';
  return v;
}

function detectDelimiter(firstLine: string): string {
  return firstLine.includes('\t') ? '\t' : ',';
}

async function upsertAdminUnit(
  client: Client,
  u: { level: string; code: string; name: string; parentId: string | null; districtId: string | null },
): Promise<string> {
  const existing = await client.query(
    `SELECT id FROM administrative_unit WHERE level = $1 AND code = $2`,
    [u.level, u.code],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const id = randomUUID();
  await client.query(
    `INSERT INTO administrative_unit (id, level, code, name, parent_id, district_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, u.level, u.code, u.name, u.parentId, u.districtId],
  );
  return id;
}

async function upsertDistrict(
  client: Client,
  u: { code: string; name: string; provinceId: string },
): Promise<string> {
  const existing = await client.query(`SELECT id FROM district WHERE code = $1`, [u.code]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const id = randomUUID();
  await client.query(
    `INSERT INTO district (id, province_id, code, name) VALUES ($1, $2, $3, $4)`,
    [id, u.provinceId, u.code, u.name],
  );
  return id;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: ts-node location-resolver.ts <path-to-csv>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running.');
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const delimiter = detectDelimiter(raw.split('\n')[0]);
  const rows: any[] = parse(raw, { columns: true, delimiter, skip_empty_lines: true });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const provinceCache = new Map<string, string>();
  const districtCache = new Map<string, string>();
  const sectorCache = new Map<string, string>();
  const cellCache = new Map<string, string>();
  const villageCache = new Map<string, string>();

  const resolved: Record<string, { village_id: string; district_id: string }> = {};
  const skipped: string[] = [];

  await client.query('BEGIN');
  try {
    for (const row of rows) {
      const provinceName = cleanName(row.province_name);
      const districtName = cleanName(row.district_name);
      const sectorName = cleanName(row.sector_name);
      const cellName = cleanName(row.cell_name);
      const villageName = cleanName(row.village_name);
      const rowKey = row.ecd_code || row.globalid || row.objectid;

      if (!provinceName || !districtName || !sectorName || !cellName || !villageName) {
        skipped.push(rowKey);
        continue;
      }

      const provinceCode = slug(provinceName);
      let provinceId = provinceCache.get(provinceCode);
      if (!provinceId) {
        provinceId = await upsertAdminUnit(client, {
          level: 'province', code: provinceCode, name: provinceName, parentId: null, districtId: null,
        });
        provinceCache.set(provinceCode, provinceId);
      }

      const districtCode = `${provinceCode}-${slug(districtName)}`;
      let districtId = districtCache.get(districtCode);
      if (!districtId) {
        districtId = await upsertDistrict(client, { code: districtCode, name: districtName, provinceId });
        districtCache.set(districtCode, districtId);
      }

      const sectorCode = `${districtCode}-${slug(sectorName)}`;
      let sectorId = sectorCache.get(sectorCode);
      if (!sectorId) {
        sectorId = await upsertAdminUnit(client, {
          level: 'sector', code: sectorCode, name: sectorName, parentId: null, districtId,
        });
        sectorCache.set(sectorCode, sectorId);
      }

      const cellCode = `${sectorCode}-${slug(cellName)}`;
      let cellId = cellCache.get(cellCode);
      if (!cellId) {
        cellId = await upsertAdminUnit(client, {
          level: 'cell', code: cellCode, name: cellName, parentId: sectorId, districtId: null,
        });
        cellCache.set(cellCode, cellId);
      }

      const villageCode = `${cellCode}-${slug(villageName)}`;
      let villageId = villageCache.get(villageCode);
      if (!villageId) {
        villageId = await upsertAdminUnit(client, {
          level: 'village', code: villageCode, name: villageName, parentId: cellId, districtId: null,
        });
        villageCache.set(villageCode, villageId);
      }

      resolved[rowKey] = { village_id: villageId, district_id: districtId };
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  fs.writeFileSync('resolved-locations.json', JSON.stringify(resolved, null, 2));

  console.log(`Resolved ${Object.keys(resolved).length} rows.`);
  console.log(
    `Unique — provinces: ${provinceCache.size}, districts: ${districtCache.size}, ` +
    `sectors: ${sectorCache.size}, cells: ${cellCache.size}, villages: ${villageCache.size}`,
  );
  if (skipped.length) {
    console.warn(`Skipped ${skipped.length} row(s) with incomplete location data:`, skipped);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
