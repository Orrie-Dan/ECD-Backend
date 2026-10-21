/**
 * Attach official MINALOC codes to sde.district / sde.administrative_unit.
 * Source: data/minaloc/villages.csv (NCDA delimitation sheet, zero-padded).
 *
 * Matching is by normalized name, top-down: district (national) → sector
 * (within district) → cell (within sector) → village (within cell).
 * Province codes are taken from the matched districts' province rows.
 * Spelling differences are reconciled ONLY through data/minaloc/name-overrides.json;
 * near-miss names are reported as suggestions, never applied.
 *
 * Dry-run by default. Only fills NULL minaloc_code; never overwrites a
 * different existing value (reported as a conflict).
 *
 * Usage:
 *   npx ts-node scripts/import-minaloc-codes.ts [--apply] [--report <path>]
 */

import { Client } from 'pg';
import { parse } from 'csv-parse/sync';
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

type Level = 'district' | 'sector' | 'cell' | 'village';

interface OfficialRow {
  province_code: string;
  province_name: string;
  district_code: string;
  district_name: string;
  sector_code: string;
  sector_name: string;
  cell_code: string;
  cell_name: string;
  village_code: string;
  village_name: string;
}

interface OfficialUnit {
  level: Level;
  code: string;
  name: string;
  parentCode: string | null;
}

interface DbUnit {
  id: string;
  name: string;
  parentKey: string | null;
  minalocCode: string | null;
}

/** Official code → DB name to match instead of the official name. */
type NameOverrides = Partial<Record<Level, Record<string, string>>>;

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const reportIdx = argv.indexOf('--report');
  const report =
    reportIdx >= 0 && argv[reportIdx + 1]
      ? path.resolve(argv[reportIdx + 1])
      : path.resolve(process.cwd(), 'minaloc-import-report.json');
  return { apply, report };
}

function loadOfficial(csvPath: string): Map<Level, Map<string, OfficialUnit>> {
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as OfficialRow[];
  const units = new Map<Level, Map<string, OfficialUnit>>([
    ['district', new Map()],
    ['sector', new Map()],
    ['cell', new Map()],
    ['village', new Map()],
  ]);
  const add = (level: Level, code: string, name: string, parentCode: string | null) => {
    const bucket = units.get(level)!;
    const existing = bucket.get(code);
    if (existing && existing.name !== name) {
      throw new Error(`Official ${level} ${code} has two names: "${existing.name}" / "${name}"`);
    }
    bucket.set(code, { level, code, name, parentCode });
  };
  for (const r of rows) {
    add('district', r.district_code, r.district_name, null);
    add('sector', r.sector_code, r.sector_name, r.district_code);
    add('cell', r.cell_code, r.cell_name, r.sector_code);
    add('village', r.village_code, r.village_name, r.cell_code);
  }
  return units;
}

async function loadDb(client: Client) {
  const districts = await client.query<{
    id: string;
    name: string;
    province_id: string;
    minaloc_code: string | null;
  }>(`SELECT id, name, province_id, minaloc_code FROM sde.district`);
  const admin = await client.query<{
    id: string;
    level: string;
    name: string;
    parent_id: string | null;
    district_id: string | null;
    minaloc_code: string | null;
  }>(
    `SELECT id, level::text AS level, name, parent_id, district_id, minaloc_code
     FROM sde.administrative_unit
     WHERE level::text IN ('province', 'sector', 'cell', 'village')`,
  );

  const db = new Map<Level | 'province', DbUnit[]>([
    ['province', []],
    ['district', []],
    ['sector', []],
    ['cell', []],
    ['village', []],
  ]);
  for (const d of districts.rows) {
    db.get('district')!.push({
      id: d.id,
      name: d.name,
      parentKey: d.province_id,
      minalocCode: d.minaloc_code,
    });
  }
  for (const a of admin.rows) {
    // Sectors hang off district_id (parent_id is null); cells/villages use parent_id.
    const parentKey = a.level === 'sector' ? a.district_id : a.parent_id;
    db.get(a.level as Level | 'province')!.push({
      id: a.id,
      name: a.name,
      parentKey,
      minalocCode: a.minaloc_code,
    });
  }
  return db;
}

interface Assignment {
  level: Level | 'province';
  id: string;
  code: string;
}

async function main() {
  const { apply, report } = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(__dirname, '../data/minaloc');
  const official = loadOfficial(path.join(dataDir, 'villages.csv'));
  const overridesPath = path.join(dataDir, 'name-overrides.json');
  const overrides: NameOverrides = fs.existsSync(overridesPath)
    ? (JSON.parse(fs.readFileSync(overridesPath, 'utf8')) as NameOverrides)
    : {};

  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    const db = await loadDb(client);

    // Index DB units by (parentKey, normalized name). Duplicates are ambiguous.
    const index = new Map<Level, Map<string, DbUnit[]>>();
    for (const level of ['district', 'sector', 'cell', 'village'] as Level[]) {
      const m = new Map<string, DbUnit[]>();
      for (const u of db.get(level)!) {
        const key = `${level === 'district' ? '' : u.parentKey}|${normalizeName(u.name)}`;
        m.set(key, [...(m.get(key) ?? []), u]);
      }
      index.set(level, m);
    }

    const matchedId = new Map<string, string>(); // `${level}:${officialCode}` → DB id
    const assignments: Assignment[] = [];
    const unmatched: Array<{
      level: Level;
      code: string;
      name: string;
      reason: string;
      suggestions?: string[];
    }> = [];
    const conflicts: Array<{
      level: string;
      id: string;
      name: string;
      existing: string;
      proposed: string;
    }> = [];
    const usedIds = new Set<string>();

    for (const level of ['district', 'sector', 'cell', 'village'] as Level[]) {
      const parentLevel: Level | null =
        level === 'district'
          ? null
          : level === 'sector'
            ? 'district'
            : level === 'cell'
              ? 'sector'
              : 'cell';
      for (const unit of official.get(level)!.values()) {
        let parentId = '';
        if (parentLevel) {
          const pid = matchedId.get(`${parentLevel}:${unit.parentCode}`);
          if (!pid) {
            unmatched.push({
              level,
              code: unit.code,
              name: unit.name,
              reason: `parent ${parentLevel} unmatched`,
            });
            continue;
          }
          parentId = pid;
        }
        const lookupName = overrides[level]?.[unit.code] ?? unit.name;
        const candidates = index.get(level)!.get(`${parentId}|${normalizeName(lookupName)}`) ?? [];
        if (candidates.length !== 1) {
          const siblings = db
            .get(level)!
            .filter((u) => (parentLevel ? u.parentKey === parentId : true));
          const target = normalizeName(lookupName);
          const suggestions = siblings
            .filter((u) => levenshtein(normalizeName(u.name), target) <= 2)
            .map((u) => u.name)
            .slice(0, 5);
          unmatched.push({
            level,
            code: unit.code,
            name: unit.name,
            reason:
              candidates.length === 0
                ? 'no DB unit with this name'
                : `${candidates.length} DB units share this name`,
            ...(suggestions.length ? { suggestions } : {}),
          });
          continue;
        }
        const hit = candidates[0];
        matchedId.set(`${level}:${unit.code}`, hit.id);
        usedIds.add(hit.id);
        if (hit.minalocCode === unit.code) continue;
        if (hit.minalocCode) {
          conflicts.push({
            level,
            id: hit.id,
            name: hit.name,
            existing: hit.minalocCode,
            proposed: unit.code,
          });
          continue;
        }
        assignments.push({ level, id: hit.id, code: unit.code });
      }
    }

    // Provinces: derive from matched districts; every district of a province must agree.
    const provinceCodeById = new Map<string, Set<string>>();
    for (const unit of official.get('district')!.values()) {
      const did = matchedId.get(`district:${unit.code}`);
      if (!did) continue;
      const district = db.get('district')!.find((d) => d.id === did)!;
      const set = provinceCodeById.get(district.parentKey!) ?? new Set<string>();
      set.add(unit.code.slice(0, 2));
      provinceCodeById.set(district.parentKey!, set);
    }
    for (const [provinceId, codes] of provinceCodeById) {
      const province = db.get('province')!.find((p) => p.id === provinceId);
      if (!province) continue;
      usedIds.add(province.id);
      if (codes.size !== 1) {
        conflicts.push({
          level: 'province',
          id: province.id,
          name: province.name,
          existing: province.minalocCode ?? '',
          proposed: [...codes].join('|'),
        });
        continue;
      }
      const code = [...codes][0];
      if (province.minalocCode === code) continue;
      if (province.minalocCode) {
        conflicts.push({
          level: 'province',
          id: province.id,
          name: province.name,
          existing: province.minalocCode,
          proposed: code,
        });
        continue;
      }
      assignments.push({ level: 'province', id: province.id, code });
    }

    const notInRegister = (['province', 'district', 'sector', 'cell', 'village'] as const).map(
      (level) => ({
        level,
        count: db.get(level)!.filter((u) => !usedIds.has(u.id) && !u.minalocCode).length,
      }),
    );

    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      official: Object.fromEntries([...official].map(([l, m]) => [l, m.size])),
      toAssign: assignments.length,
      unmatchedOfficial: Object.fromEntries(
        (['district', 'sector', 'cell', 'village'] as Level[]).map((l) => [
          l,
          unmatched.filter((u) => u.level === l).length,
        ]),
      ),
      conflicts: conflicts.length,
      dbUnitsNotInRegister: notInRegister,
    };

    fs.writeFileSync(
      report,
      JSON.stringify(
        {
          summary,
          unmatched: unmatched.filter((u) => !u.reason.startsWith('parent ')),
          unmatchedBecauseParent: unmatched.filter((u) => u.reason.startsWith('parent ')).length,
          conflicts,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Report written to ${report}`);

    if (!apply) {
      console.log('Dry run — no changes written. Re-run with --apply after reviewing the report.');
      return;
    }

    await client.query('BEGIN');
    try {
      const districtRows = assignments.filter((a) => a.level === 'district');
      const adminRows = assignments.filter((a) => a.level !== 'district');
      if (districtRows.length) {
        await client.query(
          `UPDATE sde.district d SET minaloc_code = v.code
           FROM unnest($1::text[], $2::text[]) AS v(id, code)
           WHERE d.id = v.id AND d.minaloc_code IS NULL`,
          [districtRows.map((a) => a.id), districtRows.map((a) => a.code)],
        );
      }
      if (adminRows.length) {
        await client.query(
          `UPDATE sde.administrative_unit a SET minaloc_code = v.code
           FROM unnest($1::text[], $2::text[]) AS v(id, code)
           WHERE a.id = v.id AND a.minaloc_code IS NULL`,
          [adminRows.map((a) => a.id), adminRows.map((a) => a.code)],
        );
      }
      // Code issuing needs village.district_id. Survey123-created cells/villages
      // are inserted without it, so repeat the 20260831160000 backfill here.
      await client.query(
        `UPDATE sde.administrative_unit c SET district_id = s.district_id
         FROM sde.administrative_unit s
         WHERE c.parent_id = s.id AND c.level = 'cell' AND c.district_id IS NULL
           AND s.district_id IS NOT NULL`,
      );
      await client.query(
        `UPDATE sde.administrative_unit v SET district_id = c.district_id
         FROM sde.administrative_unit c
         WHERE v.parent_id = c.id AND v.level = 'village' AND v.district_id IS NULL
           AND c.district_id IS NOT NULL`,
      );
      await client.query('COMMIT');
      console.log(`Applied ${assignments.length} codes.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
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
