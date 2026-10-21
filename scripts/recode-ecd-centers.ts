/**
 * Re-code existing ECD centers into the NCDA format PPDDSSCCVV/T/YYYY/NN.
 * The old code is kept in ecd_center.legacy_code (see survey.recode_ecd_center).
 *
 * Inputs per center (never guessed — anything missing is an exception row):
 *   type letter : ncda_type_code → Survey123 settings_types via
 *                 survey.map_settings_types_to_ncda_type (D/E split) →
 *                 facility_type (ecd_3_5 alone cannot decide D vs E)
 *   start year  : start_year → Survey123 start_year_ecd → legacy code year
 *   village     : must carry a MINALOC code (run import-minaloc-codes first)
 * NN is assigned per village in order of (start year, legacy number, created_at, id).
 *
 * Dry-run by default: writes a CSV report and changes nothing.
 * Run against a copy/staging first. Requires migrations 20261021120000–140000.
 *
 * Usage:
 *   npx ts-node scripts/recode-ecd-centers.ts [--apply] [--report <path>]
 *     [--district <4-digit MINALOC code>] [--actor <user_account id>]
 */

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

function dbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  return url.split('?')[0];
}

const NCDA_CODE = /^\d{10}\/[A-E]\/\d{4}\/\d{2}$/;
export const LEGACY_CODE = /^\d{8}\/(\d{1,4})\/(\d{2})$/;
const MIN_YEAR = 1950;

const FACILITY_TO_LETTER: Record<string, string | null> = {
  daycare: 'A',
  home_based: 'B',
  community_based: 'C',
  ecd_3_5: null, // D or E — needs settings_types
};
const LETTER_TO_FACILITY: Record<string, string> = {
  A: 'daycare',
  B: 'home_based',
  C: 'community_based',
  D: 'ecd_3_5',
  E: 'ecd_3_5',
};

export interface CenterRow {
  id: string;
  name: string;
  code: string;
  village_id: string;
  village_code: string | null;
  facility_type: string | null;
  ncda_type_code: string | null;
  start_year: number | null;
  created_at: Date;
  settings_types: string | null;
  /** survey.map_settings_types_to_ncda_type(settings_types) — computed in SQL, not duplicated here. */
  survey_letter: string | null;
  survey_year: number | null;
  last_seq: number | null;
}

export interface Plan {
  row: CenterRow;
  letter: string | null;
  letterSource: string;
  year: number | null;
  yearSource: string;
  legacySeq: number;
  problems: string[];
  notes: string[];
  proposed?: string;
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const district = value('--district');
  if (district && !/^\d{4}$/.test(district))
    throw new Error('--district must be a 4-digit MINALOC code');
  return {
    apply: argv.includes('--apply'),
    report: path.resolve(value('--report') ?? 'ecd-recode-report.csv'),
    district,
    actor: value('--actor') ?? null,
  };
}

export function planCenter(row: CenterRow, currentYear: number): Plan {
  const problems: string[] = [];
  const notes: string[] = [];
  const validYear = (y: number | null | undefined): y is number =>
    y != null && Number.isInteger(y) && y >= MIN_YEAR && y <= currentYear;

  // Type letter
  let letter: string | null = null;
  let letterSource = '';
  const surveyLetter = row.survey_letter;
  if (row.ncda_type_code) {
    letter = row.ncda_type_code;
    letterSource = 'ncda_type_code';
  } else if (surveyLetter) {
    letter = surveyLetter;
    letterSource = 'settings_types';
  } else if (row.facility_type) {
    letter = FACILITY_TO_LETTER[row.facility_type] ?? null;
    letterSource = 'facility_type';
    if (!letter)
      problems.push(
        `facility_type ${row.facility_type} cannot decide D (school-based) vs E (model)`,
      );
  } else {
    problems.push(
      `no type: facility_type empty, settings_types "${row.settings_types ?? ''}" unmapped`,
    );
  }
  if (letter && row.facility_type && LETTER_TO_FACILITY[letter] !== row.facility_type) {
    problems.push(
      `type ${letter} (${letterSource}) contradicts facility_type ${row.facility_type}`,
    );
    letter = null;
  }

  // Start year
  const legacy = LEGACY_CODE.exec(row.code);
  const legacyYear = legacy ? Number(legacy[1]) : null;
  const legacySeq = legacy ? Number(legacy[2]) : 99;
  let year: number | null = null;
  let yearSource = '';
  if (validYear(row.start_year)) {
    year = row.start_year;
    yearSource = 'start_year';
  } else if (validYear(row.survey_year)) {
    year = row.survey_year;
    yearSource = 'start_year_ecd';
  } else if (validYear(legacyYear)) {
    year = legacyYear;
    yearSource = 'legacy_code';
  } else {
    problems.push(
      `no valid start year (survey ${row.survey_year ?? '-'}, legacy ${legacyYear ?? '-'})`,
    );
  }
  if (year != null && validYear(legacyYear) && legacyYear !== year) {
    notes.push(`legacy code year ${legacyYear} differs from ${yearSource} ${year}`);
  }

  if (!row.village_code) problems.push('village has no MINALOC code');
  if (!legacy) notes.push('current code is not in the 8-digit legacy format');

  return { row, letter, letterSource, year, yearSource, legacySeq, problems, notes };
}

/** NN order inside a village: start year, legacy number, created_at, id. */
export function compareWithinVillage(a: Plan, b: Plan): number {
  return (
    a.year! - b.year! ||
    a.legacySeq - b.legacySeq ||
    a.row.created_at.getTime() - b.row.created_at.getTime() ||
    a.row.id.localeCompare(b.row.id)
  );
}

/** Apply order; matches assignPreviewCodes so issued NN values equal the preview. */
export function compareIssueOrder(a: Plan, b: Plan): number {
  return a.row.village_id.localeCompare(b.row.village_id) || compareWithinVillage(a, b);
}

/** Assign preview NN per village in deterministic order; marks overflow (>99). */
export function assignPreviewCodes(plans: Plan[]): void {
  const byVillage = new Map<string, Plan[]>();
  for (const p of plans.filter((x) => x.problems.length === 0)) {
    byVillage.set(p.row.village_id, [...(byVillage.get(p.row.village_id) ?? []), p]);
  }
  for (const group of byVillage.values()) {
    group.sort(compareWithinVillage);
    let seq = group[0].row.last_seq ?? 0;
    for (const p of group) {
      seq += 1;
      if (seq > 99) {
        p.problems.push('village would exceed 99 facility numbers');
        continue;
      }
      p.proposed = `${p.row.village_code}/${p.letter}/${p.year}/${String(seq).padStart(2, '0')}`;
    }
  }
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function loadCenters(client: Client, district?: string): Promise<CenterRow[]> {
  const hasSurvey = (
    await client.query<{ t: string | null }>(
      `SELECT to_regclass('sde.ecd_mapping_form')::text AS t`,
    )
  ).rows[0].t;
  const surveyJoin = hasSurvey
    ? `LEFT JOIN LATERAL (
         SELECT m.settings_types, extract(year FROM m.start_year_ecd)::int AS survey_year
         FROM sde.ecd_mapping_form m
         WHERE m.center_id = c.id OR m.ecd_code = c.code
         ORDER BY (m.center_id = c.id) DESC, m.last_edited_date DESC NULLS LAST, m.objectid DESC
         LIMIT 1
       ) s ON true`
    : `LEFT JOIN LATERAL (SELECT NULL::text AS settings_types, NULL::int AS survey_year) s ON true`;
  const res = await client.query<CenterRow>(
    `SELECT c.id, c.name, c.code, c.village_id, v.minaloc_code AS village_code,
            c.facility_type, c.ncda_type_code, c.start_year, c.created_at,
            s.settings_types, survey.map_settings_types_to_ncda_type(s.settings_types) AS survey_letter,
            s.survey_year, q.last_seq
     FROM sde.ecd_center c
     JOIN sde.administrative_unit v ON v.id = c.village_id
     LEFT JOIN sde.ecd_code_sequence q ON q.village_id = c.village_id
     ${surveyJoin}
     WHERE c.deleted_at IS NULL
       AND NOT survey.is_ncda_ecd_code(c.code)
       AND ($1::text IS NULL OR left(v.minaloc_code, 4) = $1)`,
    [district ?? null],
  );
  return res.rows;
}

async function main() {
  const { apply, report, district, actor } = parseArgs(process.argv.slice(2));
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    const rows = await loadCenters(client, district);
    const currentYear = new Date().getUTCFullYear();
    const plans = rows.map((r) => planCenter(r, currentYear));
    assignPreviewCodes(plans);

    const header = [
      'center_id',
      'name',
      'current_code',
      'proposed_code',
      'type',
      'type_source',
      'start_year',
      'year_source',
      'status',
      'problems',
      'notes',
    ];
    const lines = [header.join(',')];
    for (const p of plans) {
      lines.push(
        [
          p.row.id,
          p.row.name,
          p.row.code,
          p.proposed ?? '',
          p.letter ?? '',
          p.letterSource,
          p.year ?? '',
          p.yearSource,
          p.problems.length ? 'exception' : 'ok',
          p.problems.join('; '),
          p.notes.join('; '),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    fs.writeFileSync(report, lines.join('\n') + '\n');

    const ready = plans.filter((p) => p.proposed && p.problems.length === 0);
    const reasons = new Map<string, number>();
    for (const p of plans)
      for (const pr of p.problems) {
        const key = pr.replace(/\d{4}|"[^"]*"|\([^)]*\)/g, '…');
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          district: district ?? 'all',
          centersToRecode: plans.length,
          ready: ready.length,
          exceptions: plans.length - ready.length,
          exceptionReasons: Object.fromEntries(reasons),
        },
        null,
        2,
      ),
    );
    console.log(`Report written to ${report}`);

    if (!apply) {
      console.log('Dry run — no changes written. Review the report, then re-run with --apply.');
      return;
    }

    // Same order as the preview so issued NN values match proposed codes.
    const ordered = [...ready].sort(compareIssueOrder);
    let applied = 0;
    let mismatched = 0;
    const BATCH = 200;
    for (let i = 0; i < ordered.length; i += BATCH) {
      const batch = ordered.slice(i, i + BATCH);
      await client.query('BEGIN');
      try {
        for (const p of batch) {
          const res = await client.query<{ code: string }>(
            `SELECT survey.recode_ecd_center($1, $2, $3, $4) AS code`,
            [p.row.id, p.letter, p.year, actor],
          );
          if (res.rows[0].code !== p.proposed) {
            mismatched += 1;
            console.warn(`Center ${p.row.id}: issued ${res.rows[0].code}, previewed ${p.proposed}`);
          }
          applied += 1;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      console.log(`Applied ${applied}/${ordered.length}`);
    }
    console.log(`Done. Re-coded ${applied} centers (${mismatched} differ from preview).`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
