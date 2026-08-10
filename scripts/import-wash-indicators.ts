/**
 * Step 3: wash_indicator import
 *
 * Reads the survey CSV and inserts one wash_indicator row per center,
 * using visited_date as the snapshot date. Looks up center_id by the
 * ecd_center.code already imported in step 2 — run that first.
 *
 * Idempotent: if a row already exists for the same (center_id, recorded_date),
 * it's updated in place rather than duplicated. (The schema doesn't enforce
 * this pairing as unique, so this script enforces it itself.)
 *
 * IMPORTANT — recorded_by is NOT NULL on wash_indicator, but this is a bulk
 * historical import, not a caregiver action, so there's no real actor to
 * attribute it to. You need a system/import user_account row (e.g. an
 * ncda_admin service account) and must pass its id via IMPORT_USER_ID.
 * Create that account first if it doesn't exist yet.
 *
 * Assumption: water_source_type is inferred as 'piped' when piped_water is
 * true, else left null — the CSV has no separate water-source-type field.
 * latrine_count is left null; the CSV only has a yes/no toilets flag, not a
 * count.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host/db \
 *   IMPORT_USER_ID=<uuid-of-a-real-user_account> \
 *   npx ts-node import-wash-indicators.ts path/to/survey.csv
 */

import { Client } from 'pg';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

function detectDelimiter(firstLine: string): string {
  return firstLine.includes('\t') ? '\t' : ',';
}

function parseBool(raw: string | undefined): boolean {
  const v = (raw || '').trim().toLowerCase();
  return v === '1' || v === 'yes' || v === 'true';
}

function parseDateOnly(raw: string | undefined): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: ts-node import-wash-indicators.ts <path-to-csv>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running.');
    process.exit(1);
  }
  const importUserId = process.env.IMPORT_USER_ID;
  if (!importUserId) {
    console.error('Set IMPORT_USER_ID to a real user_account.id (a system/import account) before running.');
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const delimiter = detectDelimiter(raw.split('\n')[0]);
  const rows: any[] = parse(raw, { columns: true, delimiter, skip_empty_lines: true });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let inserted = 0;
  let updated = 0;
  const skipped: { key: string; reason: string }[] = [];

  await client.query('BEGIN');
  try {
    for (const row of rows) {
      const code = (row.ecd_code || '').trim();
      const rowKey = code || row.globalid || row.objectid;

      if (!code) {
        skipped.push({ key: rowKey, reason: 'missing ecd_code' });
        continue;
      }

      const centerResult = await client.query(`SELECT id FROM ecd_center WHERE code = $1`, [code]);
      if (centerResult.rows.length === 0) {
        skipped.push({ key: rowKey, reason: 'no matching ecd_center (run import-centers.ts first)' });
        continue;
      }
      const centerId = centerResult.rows[0].id;

      const recordedDate = parseDateOnly(row.visited_date);
      if (!recordedDate) {
        skipped.push({ key: rowKey, reason: 'missing or unparseable visited_date' });
        continue;
      }

      const waterAvailable = parseBool(row.piped_water);
      const waterType = waterAvailable ? 'piped' : null;
      const sanitationAvailable = parseBool(row.toilets);
      const handwashingAvailable = parseBool(row.hand_washing_stations);
      const wasteAvailable = parseBool(row.wash_disposal);

      const existing = await client.query(
        `SELECT id FROM wash_indicator WHERE center_id = $1 AND recorded_date = $2`,
        [centerId, recordedDate],
      );

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE wash_indicator
           SET water_source_available = $1, water_source_type = $2,
               sanitation_facility_available = $3, handwashing_facility_available = $4,
               waste_management_available = $5
           WHERE id = $6`,
          [waterAvailable, waterType, sanitationAvailable, handwashingAvailable, wasteAvailable, existing.rows[0].id],
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO wash_indicator
             (id, center_id, recorded_date, water_source_available, water_source_type,
              sanitation_facility_available, handwashing_facility_available,
              waste_management_available, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(), centerId, recordedDate, waterAvailable, waterType,
            sanitationAvailable, handwashingAvailable, wasteAvailable, importUserId,
          ],
        );
        inserted++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  console.log(`Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped.length}`);
  if (skipped.length) {
    console.warn('Skipped rows:', skipped);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
