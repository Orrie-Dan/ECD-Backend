/**
 * Apply the cleaned NCDA ECD list (data/ecd-centers/ecd_location.csv) to sde.ecd_center
 * and give every listed facility its NCDA code PPDDSSCCVV/T/YYYY/NN.
 *
 * Per sheet row (the sheet is the source of truth for type and start year):
 *   match   : ECD code = ecd_center.code → = ecd_center.legacy_code (re-runs) →
 *             unique district/sector/cell/village + name among unclaimed centers
 *   type    : "12. Type of Settings", else settings_types_temp, compared case-insensitively
 *             against the spellings of survey.map_settings_types_to_ncda_type
 *   year    : year of "5. Start Year …" (1950 … current year)
 *   skipped : Data Check = Remove (left untouched)
 * Rows without a usable type or year, or whose village has no MINALOC code, are
 * exceptions: reported, never guessed, and keep their legacy code.
 *
 * Duplicates: a live center not in the sheet with the same village + name as a
 * kept sheet center is soft-deleted, unless any table other than classroom /
 * ecd_code_registry references it (protected). Groups with more duplicates than
 * sheet centers are ambiguous and left alone. Each duplicate is paired with the
 * nearest sheet center; its Survey123 row (ecd_mapping_form.center_id) is moved
 * to that center when the center has none, so a later Survey123 edit updates the
 * real center instead of re-creating the duplicate.
 *
 * Codes are issued by survey.recode_ecd_center (legacy code kept in legacy_code),
 * in the same order as scripts/recode-ecd-centers.ts.
 *
 * Dry-run by default: writes a CSV report and changes nothing. Run against a
 * copy/staging first. Requires migrations 20261021120000–140000 and
 * `npm run import:minaloc-codes -- --apply`.
 *
 * Usage:
 *   npx ts-node scripts/apply-ecd-sheet.ts [--apply] [--file <csv>] [--report <path>]
 *     [--actor <user_account id>]
 */

import { Client } from 'pg';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import {
  CenterRow,
  LEGACY_CODE,
  Plan,
  assignPreviewCodes,
  compareIssueOrder,
} from './recode-ecd-centers';

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
const MIN_YEAR = 1950;

const LETTER_TO_FACILITY: Record<string, string> = {
  A: 'daycare',
  B: 'home_based',
  C: 'community_based',
  D: 'ecd_3_5',
  E: 'ecd_3_5',
};

/**
 * Spellings accepted by survey.map_settings_types_to_ncda_type. The sheet mixes
 * capitalisations ("Community Based ECD Centre"), so they are compared
 * case-insensitively here; checkLetterMapping() proves this table matches the DB.
 */
export const DB_SETTINGS_SPELLINGS: Readonly<Record<string, string>> = Object.freeze({
  'Home based ECD': 'B',
  'Home Based ECD': 'B',
  'Community based ECD centre': 'C',
  'Community Based ECD': 'C',
  'School based ECD Centre': 'D',
  'School Based ECD': 'D',
  'Model ECD centre': 'E',
  'Model ECD': 'E',
});

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

const LETTER_BY_NORM = new Map(Object.entries(DB_SETTINGS_SPELLINGS).map(([k, v]) => [norm(k), v]));

export function letterFor(raw: string | null | undefined): string | null {
  return LETTER_BY_NORM.get(norm(raw)) ?? null;
}

export const SHEET_COLUMNS = [
  'objectid',
  'ecd_code',
  'name',
  'province',
  'district',
  'sector',
  'cell',
  'village',
  'start_date',
  'settings_types',
  'settings_types_temp',
  'active',
  'data_check',
] as const;

export type SheetRow = Record<(typeof SHEET_COLUMNS)[number], string>;

export interface DbCenter {
  id: string;
  code: string;
  legacy_code: string | null;
  name: string;
  village_id: string;
  village_code: string | null;
  facility_type: string | null;
  ncda_type_code: string | null;
  start_year: number | null;
  created_at: Date;
  latitude: number | null;
  longitude: number | null;
  district: string | null;
  sector: string | null;
  cell: string | null;
  village: string | null;
  last_seq: number | null;
}

export type SheetStatus =
  'remove' | 'not_in_db' | 'ambiguous' | 'already_coded' | 'exception' | 'recode';

export interface SheetPlan {
  sheet: SheetRow;
  center: DbCenter | null;
  matchedBy: '' | 'code' | 'legacy_code' | 'name_location';
  letter: string | null;
  letterSource: string;
  year: number | null;
  problems: string[];
  notes: string[];
  /** Set when the center can be re-coded; shared with assignPreviewCodes. */
  plan?: Plan;
}

export function sheetType(row: SheetRow): {
  letter: string | null;
  source: string;
  problem?: string;
} {
  const main = letterFor(row.settings_types);
  const temp = letterFor(row.settings_types_temp);
  if (main && temp && main !== temp) {
    return {
      letter: null,
      source: '',
      problem: `settings_types "${row.settings_types}" (${main}) contradicts settings_types_temp "${row.settings_types_temp}" (${temp})`,
    };
  }
  if (main) return { letter: main, source: 'settings_types' };
  if (temp) return { letter: temp, source: 'settings_types_temp' };
  return {
    letter: null,
    source: '',
    problem: `no NCDA type for settings "${row.settings_types}" / "${row.settings_types_temp}"`,
  };
}

export function sheetYear(
  row: SheetRow,
  currentYear: number,
): { year: number | null; problem?: string } {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(row.start_date.trim());
  if (!m) return { year: null, problem: 'no start year' };
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > currentYear) {
    return { year: null, problem: `start year ${year} outside ${MIN_YEAR}–${currentYear}` };
  }
  return { year };
}

const locationKey = (
  district: unknown,
  sector: unknown,
  cell: unknown,
  village: unknown,
  name: unknown,
) => [district, sector, cell, village, name].map((v) => norm(v as string)).join('|');

/** Match sheet rows to live centers and decide type, year and status inputs. */
export function planSheet(rows: SheetRow[], centers: DbCenter[], currentYear: number): SheetPlan[] {
  const byCode = new Map(centers.map((c) => [c.code, c]));
  const byLegacy = new Map(centers.filter((c) => c.legacy_code).map((c) => [c.legacy_code!, c]));
  const claimed = new Set<string>();

  const plans: SheetPlan[] = rows.map((sheet) => {
    const code = sheet.ecd_code.trim();
    let center: DbCenter | null = null;
    let matchedBy: SheetPlan['matchedBy'] = '';
    if (code && byCode.has(code)) {
      center = byCode.get(code)!;
      matchedBy = 'code';
    } else if (code && byLegacy.has(code)) {
      center = byLegacy.get(code)!;
      matchedBy = 'legacy_code';
    }
    if (center && claimed.has(center.id)) {
      center = null;
      matchedBy = '';
    }
    if (center) claimed.add(center.id);
    return {
      sheet,
      center,
      matchedBy,
      letter: null,
      letterSource: '',
      year: null,
      problems: [],
      notes: [],
    };
  });

  // Name + location fallback: exactly one unmatched sheet row and one unclaimed center per key.
  const unmatched = plans.filter((p) => !p.center);
  const sheetByKey = new Map<string, SheetPlan[]>();
  for (const p of unmatched) {
    const s = p.sheet;
    const k = locationKey(s.district, s.sector, s.cell, s.village, s.name);
    sheetByKey.set(k, [...(sheetByKey.get(k) ?? []), p]);
  }
  const centerByKey = new Map<string, DbCenter[]>();
  for (const c of centers) {
    if (claimed.has(c.id)) continue;
    const k = locationKey(c.district, c.sector, c.cell, c.village, c.name);
    if (sheetByKey.has(k)) centerByKey.set(k, [...(centerByKey.get(k) ?? []), c]);
  }
  for (const [k, group] of sheetByKey) {
    const candidates = centerByKey.get(k) ?? [];
    if (group.length === 1 && candidates.length === 1) {
      group[0].center = candidates[0];
      group[0].matchedBy = 'name_location';
      claimed.add(candidates[0].id);
    } else if (candidates.length > 0) {
      for (const p of group) {
        p.problems.push(
          `ambiguous name/location match (${group.length} sheet rows, ${candidates.length} centers)`,
        );
      }
    }
  }

  for (const p of plans) {
    const { sheet, center } = p;
    if (!center) continue;

    const t = sheetType(sheet);
    const y = sheetYear(sheet, currentYear);
    p.letter = t.letter;
    p.letterSource = t.source;
    p.year = y.year;
    if (norm(sheet.data_check) === 'remove') continue;

    if (
      locationKey(sheet.district, sheet.sector, sheet.cell, sheet.village, sheet.name) !==
      locationKey(center.district, center.sector, center.cell, center.village, center.name)
    ) {
      p.notes.push('sheet name/location differs from DB (not applied)');
    }

    if (NCDA_CODE.test(center.code)) {
      const [, letter, year] = center.code.split('/');
      if ((p.letter && letter !== p.letter) || (p.year && Number(year) !== p.year)) {
        p.notes.push(
          `code ${center.code} disagrees with sheet type ${p.letter ?? '-'} / year ${p.year ?? '-'}`,
        );
      }
      continue;
    }

    if (t.problem) p.problems.push(t.problem);
    if (y.problem) p.problems.push(y.problem);
    if (!center.village_code) p.problems.push('village has no MINALOC code');
    if (p.letter && center.facility_type && LETTER_TO_FACILITY[p.letter] !== center.facility_type) {
      p.notes.push(`facility_type ${center.facility_type} → ${LETTER_TO_FACILITY[p.letter]}`);
    }
    const legacy = LEGACY_CODE.exec(center.code);
    if (legacy && p.year && Number(legacy[1]) !== p.year) {
      p.notes.push(`legacy code year ${legacy[1]} differs from sheet ${p.year}`);
    }
    if (p.problems.length) continue;

    const row: CenterRow = {
      id: center.id,
      name: center.name,
      code: center.code,
      village_id: center.village_id,
      village_code: center.village_code,
      facility_type: center.facility_type,
      ncda_type_code: center.ncda_type_code,
      start_year: center.start_year,
      created_at: center.created_at,
      settings_types: null,
      survey_letter: null,
      survey_year: null,
      last_seq: center.last_seq,
    };
    p.plan = {
      row,
      letter: p.letter,
      letterSource: p.letterSource,
      year: p.year,
      yearSource: 'sheet',
      legacySeq: legacy ? Number(legacy[2]) : 99,
      problems: p.problems,
      notes: p.notes,
    };
  }

  assignPreviewCodes(plans.flatMap((p) => (p.plan ? [p.plan] : [])));
  return plans;
}

export function sheetStatus(p: SheetPlan): SheetStatus {
  if (norm(p.sheet.data_check) === 'remove') return 'remove';
  if (!p.center) return p.problems.length ? 'ambiguous' : 'not_in_db';
  if (NCDA_CODE.test(p.center.code)) return 'already_coded';
  return p.plan?.proposed && p.problems.length === 0 ? 'recode' : 'exception';
}

export type DuplicateAction = 'delete' | 'protected' | 'ambiguous' | 'not_in_sheet';

export interface DuplicatePlan {
  center: DbCenter;
  action: DuplicateAction;
  keep: DbCenter | null;
  relinkForm: boolean;
  note: string;
}

function distance(a: DbCenter, b: DbCenter): number {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return Number.POSITIVE_INFINITY;
  }
  const dLat = a.latitude - b.latitude;
  const dLon = (a.longitude - b.longitude) * Math.cos((a.latitude * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
}

/**
 * Plan soft-deletes for live centers that no sheet row claimed.
 * keptIds: centers claimed by non-Remove sheet rows; claimedIds: all claimed (incl. Remove).
 */
export function planDuplicates(
  centers: DbCenter[],
  keptIds: Set<string>,
  claimedIds: Set<string>,
  protectedIds: Set<string>,
  formCenterIds: Set<string>,
): DuplicatePlan[] {
  const key = (c: DbCenter) => `${c.village_id}|${norm(c.name)}`;
  const kept = new Map<string, DbCenter[]>();
  for (const c of centers) {
    if (keptIds.has(c.id)) kept.set(key(c), [...(kept.get(key(c)) ?? []), c]);
  }
  const groups = new Map<string, DbCenter[]>();
  const out: DuplicatePlan[] = [];
  for (const c of centers) {
    if (claimedIds.has(c.id)) continue;
    if (NCDA_CODE.test(c.code) || !kept.has(key(c))) {
      out.push({ center: c, action: 'not_in_sheet', keep: null, relinkForm: false, note: '' });
      continue;
    }
    groups.set(key(c), [...(groups.get(key(c)) ?? []), c]);
  }

  const relinkTargets = new Set<string>();
  for (const [k, dups] of groups) {
    const keeps = kept.get(k)!;
    if (dups.length > keeps.length) {
      for (const c of dups) {
        out.push({
          center: c,
          action: protectedIds.has(c.id) ? 'protected' : 'ambiguous',
          keep: null,
          relinkForm: false,
          note: `${dups.length} duplicates for ${keeps.length} sheet centers`,
        });
      }
      continue;
    }
    const pairs = dups
      .flatMap((d) => keeps.map((s) => ({ d, s, dist: distance(d, s) })))
      .sort(
        (a, b) => a.dist - b.dist || a.d.id.localeCompare(b.d.id) || a.s.id.localeCompare(b.s.id),
      );
    const pairedDup = new Map<string, DbCenter>();
    const usedKeep = new Set<string>();
    for (const { d, s } of pairs) {
      if (pairedDup.has(d.id) || usedKeep.has(s.id)) continue;
      pairedDup.set(d.id, s);
      usedKeep.add(s.id);
    }
    for (const d of dups) {
      const s = pairedDup.get(d.id)!;
      if (protectedIds.has(d.id)) {
        out.push({
          center: d,
          action: 'protected',
          keep: s,
          relinkForm: false,
          note: 'has dependent records',
        });
        continue;
      }
      const relinkForm =
        formCenterIds.has(d.id) && !formCenterIds.has(s.id) && !relinkTargets.has(s.id);
      if (relinkForm) relinkTargets.add(s.id);
      out.push({
        center: d,
        action: 'delete',
        keep: s,
        relinkForm,
        note:
          formCenterIds.has(d.id) && !relinkForm
            ? 'Survey123 row stays on the deleted center (sheet center already linked)'
            : '',
      });
    }
  }
  return out;
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    apply: argv.includes('--apply'),
    file: path.resolve(value('--file') ?? 'data/ecd-centers/ecd_location.csv'),
    report: path.resolve(value('--report') ?? 'ecd-sheet-report.csv'),
    actor: value('--actor') ?? null,
  };
}

function readSheet(file: string): SheetRow[] {
  const rows: SheetRow[] = parse(fs.readFileSync(file, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
  const missing = SHEET_COLUMNS.filter((c) => rows.length && !(c in rows[0]));
  if (missing.length) throw new Error(`${file} is missing columns: ${missing.join(', ')}`);
  return rows;
}

async function checkPrerequisites(client: Client) {
  const r = (
    await client.query<{ recode: boolean; mapper: boolean; minaloc: boolean }>(
      `SELECT to_regprocedure('survey.recode_ecd_center(text,text,integer,text)') IS NOT NULL AS recode,
              to_regprocedure('survey.map_settings_types_to_ncda_type(text)') IS NOT NULL AS mapper,
              EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'sde' AND table_name = 'administrative_unit'
                        AND column_name = 'minaloc_code') AS minaloc`,
    )
  ).rows[0];
  if (!r.recode || !r.mapper || !r.minaloc) {
    throw new Error('NCDA coding migrations missing: run `npx prisma migrate deploy` first');
  }
  const coded = (
    await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM sde.administrative_unit WHERE level = 'village' AND minaloc_code IS NOT NULL`,
    )
  ).rows[0].n;
  if (Number(coded) === 0) {
    throw new Error(
      'No village has a MINALOC code: run `npm run import:minaloc-codes -- --apply` first',
    );
  }
}

/** Fail fast if the case-insensitive table drifts from the DB mapping function. */
async function checkLetterMapping(client: Client) {
  const res = await client.query<{ v: string; letter: string | null }>(
    `SELECT v, survey.map_settings_types_to_ncda_type(v) AS letter FROM unnest($1::text[]) AS v`,
    [Object.keys(DB_SETTINGS_SPELLINGS)],
  );
  const drift = res.rows.filter((r) => r.letter !== DB_SETTINGS_SPELLINGS[r.v]);
  if (drift.length) {
    throw new Error(
      `DB_SETTINGS_SPELLINGS disagrees with survey.map_settings_types_to_ncda_type: ${drift
        .map((d) => `${d.v} → ${d.letter}`)
        .join(', ')}`,
    );
  }
}

async function loadCenters(client: Client): Promise<DbCenter[]> {
  const res = await client.query<DbCenter>(
    `SELECT c.id, c.code, c.legacy_code, c.name, c.village_id, v.minaloc_code AS village_code,
            c.facility_type, c.ncda_type_code, c.start_year, c.created_at,
            c.latitude::float8 AS latitude, c.longitude::float8 AS longitude,
            d.name AS district, s.name AS sector, cl.name AS cell, v.name AS village,
            q.last_seq
     FROM sde.ecd_center c
     JOIN sde.administrative_unit v ON v.id = c.village_id
     LEFT JOIN sde.administrative_unit cl ON cl.id = v.parent_id
     LEFT JOIN sde.administrative_unit s ON s.id = cl.parent_id
     LEFT JOIN sde.district d ON d.id = c.district_id
     LEFT JOIN sde.ecd_code_sequence q ON q.village_id = c.village_id
     WHERE c.deleted_at IS NULL`,
  );
  return res.rows;
}

/** Centers referenced by any table except auto-seeded classrooms and the code registry. */
async function loadProtectedIds(client: Client): Promise<Set<string>> {
  const fks = (
    await client.query<{ tbl: string; col: string; relname: string }>(
      `SELECT k.conrelid::regclass::text AS tbl, a.attname AS col, r.relname
       FROM pg_constraint k
       JOIN pg_class r ON r.oid = k.conrelid
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
       WHERE k.contype = 'f' AND k.confrelid = 'sde.ecd_center'::regclass`,
    )
  ).rows.filter((fk) => !['classroom', 'ecd_code_registry'].includes(fk.relname));
  const ids = new Set<string>();
  for (const fk of fks) {
    const col = `"${fk.col.replace(/"/g, '""')}"`;
    const res = await client.query<{ id: string }>(
      `SELECT DISTINCT ${col} AS id FROM ${fk.tbl} WHERE ${col} IS NOT NULL`,
    );
    for (const r of res.rows) ids.add(r.id);
  }
  return ids;
}

async function loadFormCenterIds(client: Client): Promise<Set<string>> {
  const res = await client.query<{ center_id: string }>(
    `SELECT center_id FROM sde.ecd_mapping_form WHERE center_id IS NOT NULL`,
  );
  return new Set(res.rows.map((r) => r.center_id));
}

async function inBatches<T>(
  client: Client,
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
  label: string,
) {
  for (let i = 0; i < items.length; i += size) {
    await client.query('BEGIN');
    try {
      for (const item of items.slice(i, i + size)) await fn(item);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log(`${label} ${Math.min(i + size, items.length)}/${items.length}`);
  }
}

async function main() {
  const { apply, file, report, actor } = parseArgs(process.argv.slice(2));
  const rows = readSheet(file);
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    await checkPrerequisites(client);
    await checkLetterMapping(client);

    const centers = await loadCenters(client);
    const plans = planSheet(rows, centers, new Date().getUTCFullYear());
    const claimedIds = new Set(plans.flatMap((p) => (p.center ? [p.center.id] : [])));
    const keptIds = new Set(
      plans.flatMap((p) => (p.center && sheetStatus(p) !== 'remove' ? [p.center.id] : [])),
    );
    const duplicates = planDuplicates(
      centers,
      keptIds,
      claimedIds,
      await loadProtectedIds(client),
      await loadFormCenterIds(client),
    );

    const header = [
      'source',
      'objectid',
      'center_id',
      'name',
      'current_code',
      'proposed_code',
      'matched_by',
      'type',
      'type_source',
      'start_year',
      'status',
      'paired_center_id',
      'problems',
      'notes',
    ];
    const lines = [header.join(',')];
    for (const p of plans) {
      lines.push(
        [
          'sheet',
          p.sheet.objectid,
          p.center?.id,
          p.sheet.name,
          p.center?.code ?? p.sheet.ecd_code,
          p.plan?.proposed,
          p.matchedBy,
          p.letter,
          p.letterSource,
          p.year,
          sheetStatus(p),
          '',
          p.problems.join('; '),
          p.notes.join('; '),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    for (const d of duplicates) {
      lines.push(
        [
          'db_only',
          '',
          d.center.id,
          d.center.name,
          d.center.code,
          '',
          '',
          '',
          '',
          '',
          d.action,
          d.keep?.id,
          '',
          [d.relinkForm ? 'Survey123 row moved to paired center' : '', d.note]
            .filter(Boolean)
            .join('; '),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    fs.writeFileSync(report, lines.join('\n') + '\n');

    const count = <T>(items: T[], keyOf: (x: T) => string) =>
      items.reduce<Record<string, number>>((acc, x) => {
        const k = keyOf(x);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
    const toDelete = duplicates.filter((d) => d.action === 'delete');
    const toRecode = plans.filter((p) => sheetStatus(p) === 'recode').map((p) => p.plan!);
    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          sheetRows: rows.length,
          sheet: count(plans, sheetStatus),
          matchedBy: count(
            plans.filter((p) => p.center),
            (p) => p.matchedBy,
          ),
          exceptionReasons: count(
            plans.filter((p) => sheetStatus(p) === 'exception').flatMap((p) => p.problems),
            (pr) => pr.replace(/"[^"]*"|\d{4}/g, '…'),
          ),
          dbOnly: count(duplicates, (d) => d.action),
          surveyRowsRelinked: toDelete.filter((d) => d.relinkForm).length,
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

    await inBatches(
      client,
      toDelete,
      500,
      async (d) => {
        if (d.relinkForm) {
          await client.query(
            `UPDATE sde.ecd_mapping_form SET center_id = $2
             WHERE center_id = $1
               AND NOT EXISTS (SELECT 1 FROM sde.ecd_mapping_form g WHERE g.center_id = $2)`,
            [d.center.id, d.keep!.id],
          );
        }
        await client.query(
          `UPDATE sde.ecd_center
           SET deleted_at = now(), updated_at = now(), last_modified_at = now(),
               updated_by = coalesce($2, updated_by), version = version + 1
           WHERE id = $1 AND deleted_at IS NULL`,
          [d.center.id, actor],
        );
      },
      'Soft-deleted duplicates',
    );

    let mismatched = 0;
    await inBatches(
      client,
      [...toRecode].sort(compareIssueOrder),
      200,
      async (p) => {
        const res = await client.query<{ code: string }>(
          `SELECT survey.recode_ecd_center($1, $2, $3, $4) AS code`,
          [p.row.id, p.letter, p.year, actor],
        );
        if (res.rows[0].code !== p.proposed) {
          mismatched += 1;
          console.warn(`Center ${p.row.id}: issued ${res.rows[0].code}, previewed ${p.proposed}`);
        }
      },
      'Re-coded',
    );
    console.log(
      `Done. Soft-deleted ${toDelete.length} duplicates, re-coded ${toRecode.length} centers (${mismatched} differ from preview).`,
    );
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
