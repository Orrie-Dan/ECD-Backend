/**
 * Re-code planner tests (pure logic; no database).
 * Run: npx ts-node scripts/__tests__/recode-ecd-centers.spec.ts
 */
import { CenterRow, Plan, assignPreviewCodes, planCenter } from '../recode-ecd-centers';

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

function row(overrides: Partial<CenterRow> = {}): CenterRow {
  return {
    id: 'c1',
    name: 'Center',
    code: '11010101/2019/02',
    village_id: 'v1',
    village_code: '0101010101',
    facility_type: 'community_based',
    ncda_type_code: null,
    start_year: null,
    created_at: new Date('2024-01-01'),
    settings_types: null,
    survey_letter: null,
    survey_year: null,
    last_seq: null,
    ...overrides,
  };
}

assert('type from facility_type, year from legacy code', () => {
  const p = planCenter(row(), YEAR);
  eq(
    [p.letter, p.letterSource, p.year, p.yearSource, p.problems],
    ['C', 'facility_type', 2019, 'legacy_code', []],
  );
});

assert('settings_types splits ecd_3_5 into D / E', () => {
  eq(
    planCenter(
      row({ facility_type: 'ecd_3_5', settings_types: 'Model ECD', survey_letter: 'E' }),
      YEAR,
    ).letter,
    'E',
  );
  eq(
    planCenter(
      row({ facility_type: 'ecd_3_5', settings_types: 'School Based ECD', survey_letter: 'D' }),
      YEAR,
    ).letter,
    'D',
  );
});

assert('ecd_3_5 without settings_types is an exception (no guessing)', () => {
  const p = planCenter(row({ facility_type: 'ecd_3_5' }), YEAR);
  eq(p.letter, null);
  eq(p.problems.length, 1);
});

assert('settings_types contradicting facility_type is an exception', () => {
  const p = planCenter(
    row({ facility_type: 'daycare', settings_types: 'Home Based ECD', survey_letter: 'B' }),
    YEAR,
  );
  eq(p.letter, null);
  eq(p.problems[0].includes('contradicts'), true);
});

assert('survey start_year_ecd preferred over legacy year, difference noted', () => {
  const p = planCenter(row({ survey_year: 2017 }), YEAR);
  eq([p.year, p.yearSource], [2017, 'start_year_ecd']);
  eq(
    p.notes.some((n) => n.includes('2019')),
    true,
  );
});

assert('year 0 / 1943 / 2030 legacy years rejected when nothing better exists', () => {
  for (const code of ['11010101/0/01', '11010101/1943/01', '11010101/2030/01']) {
    const p = planCenter(row({ code }), YEAR);
    eq(p.year, null, code);
    eq(
      p.problems.some((x) => x.includes('start year')),
      true,
      code,
    );
  }
});

assert('village without MINALOC code is an exception', () => {
  eq(
    planCenter(row({ village_code: null }), YEAR).problems.includes('village has no MINALOC code'),
    true,
  );
});

assert(
  'preview NN per village ordered by year, legacy number, created_at; continues counter',
  () => {
    const plans: Plan[] = [
      planCenter(row({ id: 'late', code: '11010101/2021/01' }), YEAR),
      planCenter(row({ id: 'early-2', code: '11010101/2015/02' }), YEAR),
      planCenter(row({ id: 'early-1', code: '11010101/2015/01' }), YEAR),
      planCenter(
        row({
          id: 'other-village',
          village_id: 'v2',
          village_code: '0101010102',
          code: '11010102/2010/01',
        }),
        YEAR,
      ),
    ];
    assignPreviewCodes(plans);
    const byId = Object.fromEntries(plans.map((p) => [p.row.id, p.proposed]));
    eq(byId['early-1'], '0101010101/C/2015/01');
    eq(byId['early-2'], '0101010101/C/2015/02');
    eq(byId['late'], '0101010101/C/2021/03');
    eq(byId['other-village'], '0101010102/C/2010/01');

    const continued = [planCenter(row({ last_seq: 4 }), YEAR)];
    assignPreviewCodes(continued);
    eq(continued[0].proposed, '0101010101/C/2019/05', 'continues after existing counter');
  },
);

assert('more than 99 in one village → overflow rows become exceptions', () => {
  const plans = Array.from({ length: 101 }, (_, i) =>
    planCenter(row({ id: `c${String(i).padStart(3, '0')}` }), YEAR),
  );
  assignPreviewCodes(plans);
  eq(plans.filter((p) => p.proposed).length, 99);
  eq(plans.filter((p) => p.problems.length).length, 2);
});

console.log('\nAll recode planner tests passed.');
