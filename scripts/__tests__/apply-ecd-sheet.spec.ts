/**
 * Sheet import planner tests (pure logic; no database).
 * Run: npx ts-node scripts/__tests__/apply-ecd-sheet.spec.ts
 */
import {
  DbCenter,
  SheetRow,
  letterFor,
  planDuplicates,
  planSheet,
  sheetStatus,
  sheetType,
  sheetYear,
} from '../apply-ecd-sheet';

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
}

const YEAR = 2026;

function sheet(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    objectid: '1',
    ecd_code: '11010101/2019/01',
    name: 'Urumuri',
    province: 'Kigali',
    district: 'Nyarugenge',
    sector: 'Gitega',
    cell: 'Akabahizi',
    village: 'Gihanga',
    start_date: '2019-03-01',
    settings_types: 'Home Based ECD',
    settings_types_temp: 'Home based ECD',
    active: 'Active',
    data_check: 'Checked',
    ...overrides,
  };
}

function center(overrides: Partial<DbCenter> = {}): DbCenter {
  return {
    id: 'c1',
    code: '11010101/2019/01',
    legacy_code: null,
    name: 'Urumuri',
    village_id: 'v1',
    village_code: '0101010101',
    facility_type: 'home_based',
    ncda_type_code: null,
    start_year: null,
    created_at: new Date('2026-09-21'),
    latitude: -1.95,
    longitude: 30.05,
    district: 'Nyarugenge',
    sector: 'Gitega',
    cell: 'Akabahizi',
    village: 'Gihanga',
    last_seq: null,
    ...overrides,
  };
}

assert('settings types map case-insensitively, unknown types do not', () => {
  eq(letterFor('Community Based ECD Centre'), 'C');
  eq(letterFor(' model ECD CENTRE '), 'E');
  eq(letterFor('School Based ECD Centre'), 'D');
  eq(letterFor('Home Based ECD '), 'B');
  for (const v of ['Daycare', 'Other', '']) eq(letterFor(v), null, v);
});

assert('setting categories get the NCDA rule type (sheet spellings included)', () => {
  const expected: Array<[string, string]> = [
    ['Centre Based', 'C'],
    ['ECD in Emergency Settings', 'C'],
    ['Cross-border ECD', 'C'],
    ['ECD In Prison', 'C'],
    ['Faith-Based', 'D'],
    ['Market Based', 'A'],
    ['Mobile Crèches', 'A'],
  ];
  for (const [v, letter] of expected) eq(letterFor(v), letter, v);
});

assert('type falls back to settings_types_temp; conflicting columns are an exception', () => {
  eq(
    sheetType(
      sheet({ settings_types: 'Faith-Based', settings_types_temp: 'Community based ECD centre' }),
    ).letter,
    'C',
  );
  const conflict = sheetType(
    sheet({ settings_types: 'Home Based ECD', settings_types_temp: 'Model ECD centre' }),
  );
  eq(conflict.letter, null);
  eq(conflict.problem!.includes('contradicts'), true);
  eq(sheetType(sheet({ settings_types: 'Other', settings_types_temp: '' })).letter, null);
});

assert('a setting category yields to a temp column naming the type; alone it uses the rule', () => {
  eq(
    sheetType(
      sheet({ settings_types: 'Faith-Based', settings_types_temp: 'Community based ECD centre' }),
    ),
    { letter: 'C', source: 'settings_types_temp' },
  );
  eq(sheetType(sheet({ settings_types: 'Faith-Based', settings_types_temp: '' })), {
    letter: 'D',
    source: 'settings_types',
  });
  const directVsCategory = sheetType(
    sheet({ settings_types: 'Home Based ECD', settings_types_temp: 'Faith-based' }),
  );
  eq(directVsCategory.letter, null);
  eq(directVsCategory.problem!.includes('contradicts'), true);
});

assert('start year from date; missing → 2025; out of range rejected', () => {
  eq(sheetYear(sheet(), YEAR).year, 2019);
  eq(sheetYear(sheet({ start_date: '' }), YEAR), { year: 2025, defaulted: true });
  eq(sheetYear(sheet({ start_date: '1943-01-01' }), YEAR).year, null);
  eq(sheetYear(sheet({ start_date: '2027-01-01' }), YEAR).year, null);
});

assert('match by code, then legacy_code; proposed code uses sheet type and year', () => {
  const [byCode] = planSheet([sheet()], [center()], YEAR);
  eq(
    [byCode.matchedBy, sheetStatus(byCode), byCode.plan!.proposed],
    ['code', 'recode', '0101010101/B/2019/01'],
  );

  const recoded = center({ code: '0101010101/B/2019/01', legacy_code: '11010101/2019/01' });
  const [again] = planSheet([sheet()], [recoded], YEAR);
  eq([again.matchedBy, sheetStatus(again)], ['legacy_code', 'already_coded']);
});

assert('name/location fallback only when unique on both sides', () => {
  const ecd = center({ id: 'x', code: 'ECD0001' });
  const [hit] = planSheet([sheet({ ecd_code: '' })], [ecd], YEAR);
  eq([hit.center?.id, hit.matchedBy], ['x', 'name_location']);

  const two = planSheet(
    [sheet({ ecd_code: '' })],
    [ecd, center({ id: 'y', code: 'ECD0002' })],
    YEAR,
  );
  eq(sheetStatus(two[0]), 'ambiguous');

  const none = planSheet([sheet({ ecd_code: '', name: 'Other' })], [ecd], YEAR);
  eq(sheetStatus(none[0]), 'not_in_db');
});

assert('no start year is coded as 2025 and noted', () => {
  const [p] = planSheet([sheet({ start_date: '' })], [center()], YEAR);
  eq([sheetStatus(p), p.plan!.proposed], ['recode', '0101010101/B/2025/01']);
  eq(p.notes, ['no start year in sheet, 2025 used']);
});

assert('Remove rows, missing type, bad year and uncoded villages are not recoded', () => {
  const statuses = planSheet(
    [
      sheet({ objectid: '1', ecd_code: 'a', data_check: 'Remove' }),
      sheet({
        objectid: '2',
        ecd_code: 'b',
        settings_types: '',
        settings_types_temp: '',
      }),
      sheet({ objectid: '3', ecd_code: 'c', start_date: '1943-01-01' }),
      sheet({ objectid: '4', ecd_code: 'd' }),
    ],
    [
      center({ id: 'a', code: 'a' }),
      center({ id: 'b', code: 'b' }),
      center({ id: 'c', code: 'c' }),
      center({ id: 'd', code: 'd', village_code: null }),
    ],
    YEAR,
  ).map(sheetStatus);
  eq(statuses, ['remove', 'exception', 'exception', 'exception']);
});

assert('NN per village continues in year order across sheet rows', () => {
  const plans = planSheet(
    [
      sheet({ objectid: '1', ecd_code: 'late', start_date: '2021-01-01' }),
      sheet({ objectid: '2', ecd_code: 'early', start_date: '2015-01-01' }),
    ],
    [
      center({ id: 'late', code: 'late', last_seq: 2 }),
      center({ id: 'early', code: 'early', last_seq: 2 }),
    ],
    YEAR,
  );
  eq(
    plans.map((p) => p.plan!.proposed),
    ['0101010101/B/2021/04', '0101010101/B/2015/03'],
  );
});

assert('duplicates: delete nearest-paired, relink form only to a form-less center', () => {
  const keepNear = center({ id: 'keepNear', latitude: -1.95, longitude: 30.05 });
  const keepFar = center({ id: 'keepFar', latitude: -1.5, longitude: 30.5 });
  const dup = center({ id: 'dup', code: 'ECD0001', latitude: -1.951, longitude: 30.051 });
  const [plan] = planDuplicates(
    [keepNear, keepFar, dup],
    new Set(['keepNear', 'keepFar']),
    new Set(['keepNear', 'keepFar']),
    new Set(),
    new Set(['dup']),
  );
  eq([plan.action, plan.keep?.id, plan.relinkForm], ['delete', 'keepNear', true]);

  const [noRelink] = planDuplicates(
    [keepNear, dup],
    new Set(['keepNear']),
    new Set(['keepNear']),
    new Set(),
    new Set(['dup', 'keepNear']),
  );
  eq([noRelink.action, noRelink.relinkForm], ['delete', false]);
});

assert('duplicates: protected, ambiguous, not in sheet, Remove-row centers untouched', () => {
  const keep = center({ id: 'keep' });
  const results = planDuplicates(
    [
      keep,
      center({ id: 'protected', code: 'ECD-TEST-402' }),
      center({ id: 'lonely', code: 'ECD0003', name: 'Different' }),
      center({ id: 'removed', name: 'Removed' }),
      center({ id: 'dupOfRemoved', code: 'ECD0004', name: 'Removed' }),
    ],
    new Set(['keep']),
    new Set(['keep', 'removed']),
    new Set(['protected']),
    new Set(),
  );
  const byId = Object.fromEntries(results.map((r) => [r.center.id, r.action]));
  eq(
    [byId.protected, byId.lonely, byId.dupOfRemoved, Object.keys(byId).length],
    ['protected', 'not_in_sheet', 'not_in_sheet', 3],
  );

  const ambiguous = planDuplicates(
    [keep, center({ id: 'd1', code: 'ECD1' }), center({ id: 'd2', code: 'ECD2' })],
    new Set(['keep']),
    new Set(['keep']),
    new Set(),
    new Set(),
  );
  eq(
    ambiguous.map((r) => r.action),
    ['ambiguous', 'ambiguous'],
  );
});

console.log('\nAll sheet import planner tests passed.');
