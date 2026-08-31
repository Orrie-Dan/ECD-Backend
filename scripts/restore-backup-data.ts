/**
 * Import row data from a pg_dump plain-SQL backup into the current (new) schema.
 *
 * The backup is expected to be from BEFORE Scenario C GIS columns. This script:
 * 1. Extracts COPY ... FROM stdin blocks (skips _prisma_migrations)
 * 2. Loads them with FK checks disabled
 * 3. Backfills *_id columns, optional coded lookups, geom, and objectid sequences
 *
 * Usage:
 *   npm run restore:backup-data -- --file "C:\path\to\neon_backup_psql16.sql"
 *   npm run restore:backup-data -- --file backup.sql --url "postgresql://..." --yes
 *
 *   npm run restore:backup-data -- --file backup.sql --backfill-only
 *
 * Uses pg-copy-streams (no Docker required). Docker psql is tried first if available.
 */

import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Client } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const args = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function getOption(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = args[i + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/:[^:@/]+@/, ':***@');
  }
}

const SKIP_COPY_TABLES = new Set(['_prisma_migrations']);

function extractCopyBlocks(sql: string): {
  blocks: Array<{ header: string; body: string }>;
  tableCount: number;
} {
  const lines = sql.split(/\r?\n/);
  const blocks: Array<{ header: string; body: string }> = [];
  let inCopy = false;
  let skipCopy = false;
  let header = '';
  const bodyLines: string[] = [];

  const flush = () => {
    if (inCopy && !skipCopy && header) {
      blocks.push({ header, body: `${bodyLines.join('\n')}\n\\.\n` });
    }
    inCopy = false;
    skipCopy = false;
    header = '';
    bodyLines.length = 0;
  };

  for (const line of lines) {
    if (!inCopy) {
      const match = line.match(/^COPY public\.("?[\w_]+"?)\s*\(/);
      if (match) {
        const table = match[1].replace(/"/g, '');
        skipCopy = SKIP_COPY_TABLES.has(table);
        inCopy = true;
        header = line;
      }
      continue;
    }

    if (line === '\\.') {
      flush();
      continue;
    }

    if (!skipCopy) {
      bodyLines.push(line);
    }
  }

  flush();
  return { blocks, tableCount: blocks.length };
}

async function importViaPgCopy(url: string, blocks: Array<{ header: string; body: string }>) {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('SET session_replication_role = replica');
    await client.query('BEGIN');
    for (let i = 0; i < blocks.length; i += 1) {
      const { header, body } = blocks[i];
      const table = header.match(/^COPY public\.("?[\w_]+"?)/)?.[1] ?? '?';
      process.stdout.write(`  [${i + 1}/${blocks.length}] ${table.replace(/"/g, '')}...`);
      const stream = client.query(copyFrom(`${header}\n`));
      await pipeline(Readable.from(body), stream);
      console.log(' OK');
    }
    await client.query('COMMIT');
    await client.query('SET session_replication_role = DEFAULT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

function importViaDockerPsql(url: string, tempFile: string): boolean {
  const check = spawnSync('docker', ['info'], { encoding: 'utf8', shell: false });
  if (check.status !== 0) {
    return false;
  }

  console.log('Importing data via Docker psql...');
  const docker = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      `DATABASE_URL=${url}`,
      '-v',
      `${process.cwd()}:/work`,
      '-w',
      '/work',
      'postgres:17',
      'psql',
      url,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      'scripts/.tmp-restore-data.sql',
    ],
    { encoding: 'utf8', shell: false },
  );

  if (docker.status !== 0) {
    console.error(docker.stderr || docker.stdout);
    throw new Error(`psql import failed (exit ${docker.status})`);
  }
  return true;
}

const BACKFILL_SQL = `
-- Optional coded-string lookups from restored rows
INSERT INTO lookup_water_source_type (id, code, label_en, sort_order)
SELECT gen_random_uuid(),
  lower(regexp_replace(trim(water_source_type), '\\\\s+', '_', 'g')),
  trim(water_source_type),
  row_number() OVER (ORDER BY trim(water_source_type))
FROM wash_indicator
WHERE water_source_type IS NOT NULL AND trim(water_source_type) <> ''
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_food_source (id, code, label_en, sort_order)
SELECT gen_random_uuid(),
  lower(regexp_replace(trim(food_source), '\\\\s+', '_', 'g')),
  trim(food_source),
  row_number() OVER (ORDER BY trim(food_source))
FROM center_feeding_month_summary
WHERE food_source IS NOT NULL AND trim(food_source) <> ''
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_meal_quality (id, code, label_en, sort_order)
SELECT gen_random_uuid(),
  lower(regexp_replace(trim(meal_quality), '\\\\s+', '_', 'g')),
  trim(meal_quality),
  row_number() OVER (ORDER BY trim(meal_quality))
FROM child_nutrition_screening
WHERE meal_quality IS NOT NULL AND trim(meal_quality) <> ''
ON CONFLICT (code) DO NOTHING;

UPDATE child_nutrition_screening c SET meal_quality_id = l.id
FROM lookup_meal_quality l
WHERE c.meal_quality IS NOT NULL
  AND l.code = lower(regexp_replace(trim(c.meal_quality), '\\\\s+', '_', 'g'))
  AND c.meal_quality_id IS NULL;

UPDATE wash_indicator w SET water_source_type_id = l.id
FROM lookup_water_source_type l
WHERE w.water_source_type IS NOT NULL
  AND l.code = lower(regexp_replace(trim(w.water_source_type), '\\\\s+', '_', 'g'))
  AND w.water_source_type_id IS NULL;

UPDATE center_feeding_month_summary c SET food_source_id = l.id
FROM lookup_food_source l
WHERE c.food_source IS NOT NULL
  AND l.code = lower(regexp_replace(trim(c.food_source), '\\\\s+', '_', 'g'))
  AND c.food_source_id IS NULL;

UPDATE ecd_center e SET status_id = l.id FROM lookup_ecd_center_status l
  WHERE l.code = e.status::text AND e.status_id IS NULL;
UPDATE ecd_center e SET current_compliance_level_id = l.id FROM lookup_compliance_classification l
  WHERE l.code = e.current_compliance_level::text AND e.current_compliance_level_id IS NULL;
UPDATE administrative_unit a SET level_id = l.id FROM lookup_administrative_level l
  WHERE l.code = a.level::text AND a.level_id IS NULL;
UPDATE child_nutrition_screening c SET nutrition_status_id = l.id FROM lookup_nutrition_status l
  WHERE l.code = c.nutrition_status::text AND c.nutrition_status_id IS NULL;
UPDATE compliance_assessment c SET assessment_type_id = l.id FROM lookup_assessment_type l
  WHERE l.code = c.assessment_type::text AND c.assessment_type_id IS NULL;
UPDATE compliance_assessment c SET status_id = l.id FROM lookup_assessment_status l
  WHERE l.code = c.status::text AND c.status_id IS NULL;
UPDATE compliance_assessment c SET overall_classification_id = l.id FROM lookup_compliance_classification l
  WHERE l.code = c.overall_classification::text AND c.overall_classification_id IS NULL;
UPDATE compliance_assessment_item c SET response_id = l.id FROM lookup_item_response l
  WHERE l.code = c.response::text AND c.response_id IS NULL;
UPDATE compliance_assessment_item c SET gap_severity_id = l.id FROM lookup_gap_severity l
  WHERE l.code = c.gap_severity::text AND c.gap_severity_id IS NULL;
UPDATE compliance_assessment_item c SET gap_status_id = l.id FROM lookup_gap_status l
  WHERE l.code = c.gap_status::text AND c.gap_status_id IS NULL;
UPDATE ecd_standard e SET domain_id = l.id FROM lookup_standard_domain l
  WHERE l.code = e.domain::text AND e.domain_id IS NULL;
UPDATE child c SET gender_id = l.id FROM lookup_child_gender l
  WHERE l.code = c.gender::text AND c.gender_id IS NULL;
UPDATE child c SET status_id = l.id FROM lookup_child_status l
  WHERE l.code = c.status::text AND c.status_id IS NULL;
UPDATE attendance_record a SET status_id = l.id FROM lookup_attendance_status l
  WHERE l.code = a.status::text AND a.status_id IS NULL;
UPDATE attendance_record a SET absent_reason_id = l.id FROM lookup_absent_reason l
  WHERE l.code = a.absent_reason::text AND a.absent_reason_id IS NULL;
UPDATE sted_assessment s SET age_band_id = l.id FROM lookup_sted_age_band l
  WHERE l.code = s.age_band::text AND s.age_band_id IS NULL;
UPDATE referral r SET source_type_id = l.id FROM lookup_referral_source_type l
  WHERE l.code = r.source_type::text AND r.source_type_id IS NULL;
UPDATE referral r SET status_id = l.id FROM lookup_referral_status l
  WHERE l.code = r.status::text AND r.status_id IS NULL;
UPDATE child_transfer c SET status_id = l.id FROM lookup_transfer_status l
  WHERE l.code = c.status::text AND c.status_id IS NULL;
UPDATE classroom c SET grade_id = l.id FROM lookup_classroom_grade l
  WHERE l.code = c.grade::text AND c.grade_id IS NULL;
UPDATE parent_contribution p SET contribution_type_id = l.id FROM lookup_parent_contribution_type l
  WHERE l.code = p.contribution_type::text AND p.contribution_type_id IS NULL;
UPDATE parent_contribution p SET item_type_id = l.id FROM lookup_in_kind_item_type l
  WHERE p.item_type IS NOT NULL AND l.code = p.item_type::text AND p.item_type_id IS NULL;
UPDATE center_support c SET support_category_id = l.id FROM lookup_center_support_category l
  WHERE l.code = c.support_category::text AND c.support_category_id IS NULL;

UPDATE ecd_center SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;
UPDATE administrative_unit SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;

SELECT setval(
  pg_get_serial_sequence('ecd_center', 'objectid'),
  COALESCE((SELECT MAX(objectid) FROM ecd_center), 1)
);
SELECT setval(
  pg_get_serial_sequence('administrative_unit', 'objectid'),
  COALESCE((SELECT MAX(objectid) FROM administrative_unit), 1)
);
`;

async function runBackfill(url: string) {
  console.log('Running lookup / geom backfill...');
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(BACKFILL_SQL);
    const summary = await client.query(`
      SELECT 'ecd_center' AS t, COUNT(*)::text AS n FROM ecd_center
      UNION ALL SELECT 'child', COUNT(*)::text FROM child
      UNION ALL SELECT 'administrative_unit', COUNT(*)::text FROM administrative_unit
      UNION ALL SELECT 'ecd_center with geom', COUNT(*)::text FROM ecd_center WHERE geom IS NOT NULL
      UNION ALL SELECT 'ecd_center with status_id', COUNT(*)::text FROM ecd_center WHERE status_id IS NOT NULL
    `);
    console.log('\n--- Row counts after restore ---');
    for (const row of summary.rows) {
      console.log(`  ${row.t}: ${row.n}`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const file = getOption('file');
  const url = getOption('url') ?? process.env.DATABASE_URL;
  const dryRun = hasFlag('dry-run');
  const backfillOnly = hasFlag('backfill-only');

  if (!url) {
    console.error('DATABASE_URL not set and --url not passed');
    process.exit(1);
  }

  console.log(`Target: ${redactUrl(url)}`);

  if (backfillOnly) {
    await runBackfill(url);
    console.log('\nBackfill complete.');
    return;
  }

  if (!file) {
    console.error('Pass --file <path-to-backup.sql> or use --backfill-only');
    process.exit(1);
  }

  const filePath = resolve(file);
  if (!existsSync(filePath)) {
    console.error(`Backup not found: ${filePath}`);
    process.exit(1);
  }

  const size = statSync(filePath).size;
  if (size === 0) {
    console.error(
      `Backup file is empty (0 bytes). Use neon_backup_psql16.sql or neon_backup.sql on your Desktop instead.`,
    );
    process.exit(1);
  }

  console.log(`Backup: ${filePath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Target: ${redactUrl(url)}`);

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const schemaCheck = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ecd_center' AND column_name = 'geom'
      ) AS exists
    `);
    if (!schemaCheck.rows[0]?.exists) {
      throw new Error(
        'Target DB is missing Scenario C columns (ecd_center.geom). Run prisma migrate deploy first.',
      );
    }

    const counts = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ecd_center`,
    );
    const centerCount = Number(counts.rows[0]?.n ?? 0);
    if (centerCount > 0 && !hasFlag('yes')) {
      throw new Error(
        `Target already has ${centerCount} ecd_center rows. Re-run with --yes to import anyway (may duplicate PKs).`,
      );
    }
    if (centerCount > 0) {
      console.warn(`Warning: importing into DB that already has ${centerCount} centers`);
    }
  } finally {
    await client.end();
  }

  console.log('Reading backup and extracting COPY blocks...');
  const backupSql = readFileSync(filePath, 'utf8');
  const { blocks, tableCount } = extractCopyBlocks(backupSql);
  console.log(`Extracted ${tableCount} table COPY blocks`);

  const tempFile = resolve(process.cwd(), 'scripts', '.tmp-restore-data.sql');
  const dataSql = [
    'SET session_replication_role = replica;',
    'SET client_encoding = UTF8;',
    'BEGIN;',
    ...blocks.flatMap((b) => [b.header, b.body.trimEnd()]),
    'COMMIT;',
    'SET session_replication_role = DEFAULT;',
  ].join('\n');
  writeFileSync(tempFile, dataSql, 'utf8');
  console.log(`Wrote ${(Buffer.byteLength(dataSql) / 1024 / 1024).toFixed(1)} MB data SQL`);

  if (dryRun) {
    console.log('Dry run — stopping before import');
    return;
  }

  const usedDocker = importViaDockerPsql(url, tempFile);
  if (!usedDocker) {
    console.log('Docker unavailable — importing via pg-copy-streams...');
    await importViaPgCopy(url, blocks);
  }

  await runBackfill(url);

  try {
    unlinkSync(tempFile);
  } catch {
    // ignore
  }

  console.log('\nRestore complete. Run npm run gis:verify:phase8 to validate GIS views.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
