import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

export const GIS_PHASE_ORDER = [
  '0',
  '1',
  '1b',
  '1c',
  '1c-seed',
  '2',
  '3',
  '4',
  '5',
  '6',
  '8',
  '9',
] as const;

export type GisPhaseId = (typeof GIS_PHASE_ORDER)[number];

export const GIS_PHASE_FILES: Record<GisPhaseId, string> = {
  '0': 'phase-0-prerequisites.sql',
  '1': 'phase-1-tier1-lookups.sql',
  '1b': 'phase-1b-tier2-lookups.sql',
  '1c': 'phase-1c-optional-lookups.sql',
  '1c-seed': 'phase-1c-seed-coded-lookups.sql',
  '2': 'phase-2-fk-columns.sql',
  '3': 'phase-3-decimal-precision.sql',
  '4': 'phase-4-postgis-geometry.sql',
  '5': 'phase-5-sted-flatten.sql',
  '6': 'phase-6-gis-views.sql',
  '8': 'phase-8-feeding-view.sql',
  '9': 'phase-9-arcgis-hardening.sql',
};

export function loadEnvFile() {
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/:[^:@/]+@/, ':***@');
  }
}

export function resolvePhaseSqlPath(phase: GisPhaseId): string {
  return resolve(process.cwd(), 'docs/gis/phases', GIS_PHASE_FILES[phase]);
}

export function readPhaseSql(phase: GisPhaseId): string {
  return readFileSync(resolvePhaseSqlPath(phase), 'utf8');
}

/** Remove `--` line comments before splitting (avoids false splits on `;` in comments). */
export function stripSqlLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      if (idx === -1) return line;
      return line.slice(0, idx);
    })
    .join('\n');
}

/** Split SQL file into executable statements (respects `$$` dollar-quoted blocks). */
export function splitSqlStatements(sql: string): string[] {
  const cleaned = stripSqlLineComments(sql);
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let inDollarQuote: string | null = null;

  while (i < cleaned.length) {
    if (inDollarQuote) {
      const end = cleaned.indexOf(inDollarQuote, i);
      if (end === -1) {
        current += cleaned.slice(i);
        break;
      }
      current += cleaned.slice(i, end + inDollarQuote.length);
      i = end + inDollarQuote.length;
      inDollarQuote = null;
      continue;
    }

    const rest = cleaned.slice(i);
    const dollarMatch = rest.match(/^\$([A-Za-z0-9_]*)\$/);
    if (dollarMatch) {
      inDollarQuote = dollarMatch[0];
      current += inDollarQuote;
      i += inDollarQuote.length;
      continue;
    }

    const ch = cleaned[i];
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

/** Postgres errors that are safe to skip when re-applying GIS phases. */
export function isSkippableGisError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: string }).code) : '';
  const message = 'message' in err ? String((err as { message?: string }).message) : '';

  const skippableCodes = new Set([
    '42P07', // duplicate_table
    '42701', // duplicate_column
    '42710', // duplicate_object
    '42P06', // duplicate_schema
    '42723', // duplicate_function
    '23505', // unique_violation (seed re-run)
  ]);

  if (skippableCodes.has(code)) return true;

  const skippableMessages = [
    /already exists/i,
    /cannot alter type of a column used by a view or rule/i,
    /cannot alter type of a column used in a trigger definition/i,
  ];

  return skippableMessages.some((re) => re.test(message));
}

export type PhaseRunResult = {
  applied: number;
  skipped: number;
  failed: number;
};

export async function runPhaseIdempotent(
  client: Client,
  phase: GisPhaseId,
  options: { verbose?: boolean } = {},
): Promise<PhaseRunResult> {
  const sql = readPhaseSql(phase);
  const statements = splitSqlStatements(sql);
  const result: PhaseRunResult = { applied: 0, skipped: 0, failed: 0 };

  console.log(`\n=== Phase ${phase}: ${GIS_PHASE_FILES[phase]} (${statements.length} statements) ===`);

  for (const statement of statements) {
    const preview = statement.split('\n').find((l) => l.trim() && !l.trim().startsWith('--'));
    try {
      await client.query(`${statement};`);
      result.applied += 1;
      if (options.verbose && preview) {
        console.log(`  applied: ${preview.slice(0, 80)}`);
      }
    } catch (err) {
      if (isSkippableGisError(err)) {
        result.skipped += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  skip: ${msg.split('\n')[0]}`);
        if (preview) {
          console.log(`        at: ${preview.slice(0, 72)}`);
        }
        continue;
      }
      result.failed += 1;
      console.error(`  FAILED in phase ${phase}:`, err instanceof Error ? err.message : err);
      if (preview) {
        console.error(`        statement: ${preview.slice(0, 120)}`);
      }
      throw err;
    }
  }

  console.log(
    `Phase ${phase} OK (${result.applied} applied, ${result.skipped} skipped, ${result.failed} failed)`,
  );
  return result;
}

/** Run entire phase as one query (original behaviour — fails fast). */
export async function runPhaseStrict(client: Client, phase: GisPhaseId): Promise<void> {
  const sql = readPhaseSql(phase);
  console.log(`\n=== Phase ${phase}: ${GIS_PHASE_FILES[phase]} ===`);
  await client.query(sql);
  console.log(`Phase ${phase} OK`);
}
