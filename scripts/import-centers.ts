/**
 * Step 2: ecd_center import
 *
 * Reads the same survey CSV plus resolved-locations.json (produced by
 * location-resolver.ts) and upserts one row per center into `ecd_center`.
 *
 * Idempotent: upserts on the unique `code` column, so re-running after a
 * corrected CSV or a partial failure won't create duplicates.
 *
 * Fields with no CSV source (capacity, current_compliance_level,
 * current_compliance_assessed_at) are left null — they get populated later
 * through the app itself, not this import.
 *
 * Assumption: `phone_supervisor` is used as the center's `phone`, since the
 * CSV has no separate center-level contact field. If that number is
 * personal to the supervisor rather than the center's line, drop that
 * mapping and leave `phone` null instead.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host/db npx ts-node import-centers.ts path/to/survey.csv
 *
 * Requires resolved-locations.json to exist in the working directory
 * (output of location-resolver.ts, run against the same database first).
 */

import { Client } from 'pg';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

function detectDelimiter(firstLine: string): string {
  return firstLine.includes('\t') ? '\t' : ',';
}

function normalizeStatus(raw: string | undefined): 'active' | 'inactive' {
  const v = (raw || '').trim().toLowerCase();
  return v === 'inactive' ? 'inactive' : 'active'; // default to active, matches schema default
}

function cleanPhone(raw: string | undefined): string | null {
  const v = (raw || '').trim();
  return v && v.toLowerCase() !== 'null' ? v : null;
}

function parseCoord(raw: string | undefined): number | null {
  const v = parseFloat(raw || '');
  return Number.isFinite(v) ? v : null;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: ts-node import-centers.ts <path-to-csv>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running.');
    process.exit(1);
  }
  if (!fs.existsSync('resolved-locations.json')) {
    console.error('resolved-locations.json not found. Run location-resolver.ts first.');
    process.exit(1);
  }

  const locations: Record<string, { village_id: string; district_id: string }> = JSON.parse(
    fs.readFileSync('resolved-locations.json', 'utf-8'),
  );

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
      const rowKey = row.ecd_code || row.globalid || row.objectid;
      const code = (row.ecd_code || '').trim();
      const name = (row.name_ecd_sercive || '').trim();

      if (!code || !name) {
        skipped.push({ key: rowKey, reason: 'missing code or name' });
        continue;
      }

      const loc = locations[rowKey];
      if (!loc) {
        skipped.push({ key: rowKey, reason: 'no resolved location (run location-resolver.ts first, or check its skip log)' });
        continue;
      }

      const latitude = parseCoord(row.latitude);
      const longitude = parseCoord(row.longitude);
      const phone = cleanPhone(row.phone_supervisor);
      const status = normalizeStatus(row.active_not_active);

      const existing = await client.query(`SELECT id FROM ecd_center WHERE code = $1`, [code]);

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE ecd_center
           SET name = $1, phone = $2, latitude = $3, longitude = $4, status = $5,
               district_id = $6, village_id = $7, updated_at = now(),
               version = version + 1, sync_status = 'synced'
           WHERE code = $8`,
          [name, phone, latitude, longitude, status, loc.district_id, loc.village_id, code],
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO ecd_center
             (id, district_id, village_id, code, name, phone, latitude, longitude, status,
              version, sync_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 'synced')`,
          [randomUUID(), loc.district_id, loc.village_id, code, name, phone, latitude, longitude, status],
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
