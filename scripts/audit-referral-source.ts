/**
 * Print referral rows whose source_id does not resolve to a live source record.
 * Usage: npm run gis:audit:referrals
 */

import { Client } from 'pg';
import { loadEnvFile, redactUrl } from './gis-scenario-c-shared';

loadEnvFile();

const BAD_REFERRALS_SQL = `
SELECT r.id, r.source_type, r.source_id, r.status, r.created_at
FROM referral r
WHERE r.deleted_at IS NULL
  AND (
    (r.source_type = 'nutrition' AND NOT EXISTS (
      SELECT 1 FROM child_nutrition_screening s WHERE s.id = r.source_id AND s.deleted_at IS NULL
    ))
    OR (r.source_type = 'sted' AND NOT EXISTS (
      SELECT 1 FROM sted_assessment s WHERE s.id = r.source_id AND s.deleted_at IS NULL
    ))
  )
ORDER BY r.created_at
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  console.log(`Target: ${redactUrl(url)}\n`);

  try {
    const { rows: bad } = await client.query(BAD_REFERRALS_SQL);
    if (bad.length === 0) {
      console.log('No invalid referral source_id rows.');
      return;
    }

    console.log(`Found ${bad.length} invalid referral(s):\n`);
    for (const r of bad) {
      console.log(JSON.stringify(r, null, 2));

      if (r.source_type === 'sted') {
        const sted = await client.query(
          `SELECT id, deleted_at, child_id, center_id, created_at
           FROM sted_assessment WHERE id = $1`,
          [r.source_id],
        );
        if (sted.rows.length === 0) {
          console.log('  → sted_assessment: NOT FOUND (hard-deleted or never existed)\n');
        } else {
          console.log('  → sted_assessment:', sted.rows[0], '\n');
        }
      } else if (r.source_type === 'nutrition') {
        const scr = await client.query(
          `SELECT id, deleted_at, child_id, created_at
           FROM child_nutrition_screening WHERE id = $1`,
          [r.source_id],
        );
        if (scr.rows.length === 0) {
          console.log('  → child_nutrition_screening: NOT FOUND\n');
        } else {
          console.log('  → child_nutrition_screening:', scr.rows[0], '\n');
        }
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
