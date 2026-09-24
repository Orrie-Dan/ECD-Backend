/**
 * WHO Child Growth Standards — zone classification tests (parity with FE who-growth.test.ts).
 * Run: npx ts-node src/modules/nutrition/who/__tests__/who-growth.spec.ts
 */
import {
  classifyHeightForAge,
  classifyMuacForAge,
  classifyWeightForAge,
  getAgeInMonthsAtDate,
  getWhoZonePresentation,
  isWhoZoneResult,
  toWhoSex,
  whoSdCutoff,
  zoneFromZScore,
} from '../index';

function assert(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (e) {
      console.error(`FAIL: ${name}`);
      throw e;
    }
  })();
}

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

async function main() {
  await assert('getAgeInMonthsAtDate computes completed months at screening', () => {
    eq(getAgeInMonthsAtDate('2022-01-15', '2024-05-14'), 27);
    eq(getAgeInMonthsAtDate('2022-01-15', '2024-05-15'), 28);
  });

  await assert('getAgeInMonthsAtDate uses screening date for historical age', () => {
    const dob = '2020-06-01';
    eq(getAgeInMonthsAtDate(dob, '2022-06-01'), 24);
    eq(getAgeInMonthsAtDate(dob, '2023-06-01'), 36);
  });

  await assert('getAgeInMonthsAtDate returns null when screening before DOB', () => {
    eq(getAgeInMonthsAtDate('2022-01-10', '2022-01-09'), null);
  });

  await assert('getAgeInMonthsAtDate returns null for invalid DOB', () => {
    eq(getAgeInMonthsAtDate('not-a-date', '2024-01-01'), null);
    eq(getAgeInMonthsAtDate('', '2024-01-01'), null);
    eq(getAgeInMonthsAtDate(null, '2024-01-01'), null);
  });

  await assert('getAgeInMonthsAtDate handles month 0 (birth day)', () => {
    eq(getAgeInMonthsAtDate('2024-03-01', '2024-03-01'), 0);
  });

  await assert('toWhoSex maps male / Umuhungu to boys', () => {
    eq(toWhoSex('male'), 'boys');
    eq(toWhoSex('Umuhungu'), 'boys');
  });

  await assert('toWhoSex maps female / Umukobwa to girls', () => {
    eq(toWhoSex('female'), 'girls');
    eq(toWhoSex('Umukobwa'), 'girls');
  });

  await assert('toWhoSex rejects unsupported values', () => {
    eq(toWhoSex('other'), null);
    eq(toWhoSex(undefined), null);
  });

  await assert('zoneFromZScore maps SD boundaries', () => {
    eq(zoneFromZScore(-3.1), 'below_minus_3');
    eq(zoneFromZScore(-2.5), 'minus_3_to_minus_2');
    eq(zoneFromZScore(-1.5), 'minus_2_to_minus_1');
    eq(zoneFromZScore(-0.5), 'minus_1_to_median');
    eq(zoneFromZScore(0.5), 'median_to_plus_1');
    eq(zoneFromZScore(1.5), 'plus_1_to_plus_2');
    eq(zoneFromZScore(2.5), 'plus_2_to_plus_3');
    eq(zoneFromZScore(3.0), 'above_plus_3');
  });

  const base = {
    dateOfBirth: '2022-01-01',
    screeningDate: '2024-01-01', // 24 months
  };

  await assert('classifyWeightForAge uses boys reference for male', () => {
    const median = whoSdCutoff('weight_for_age', 'boys', 24, 0)!;
    const result = classifyWeightForAge({
      ...base,
      gender: 'male',
      weightKg: median,
    });
    eq(isWhoZoneResult(result), true);
    if (isWhoZoneResult(result)) {
      eq(result.sex, 'boys');
      eq(result.ageMonths, 24);
      eq(result.zone, 'median_to_plus_1');
    }
  });

  await assert('classifyWeightForAge uses girls reference for female', () => {
    const median = whoSdCutoff('weight_for_age', 'girls', 24, 0)!;
    const result = classifyWeightForAge({
      ...base,
      gender: 'Umukobwa',
      weightKg: median,
    });
    eq(isWhoZoneResult(result), true);
    if (isWhoZoneResult(result)) {
      eq(result.sex, 'girls');
      eq(result.zone, 'median_to_plus_1');
    }
  });

  await assert('classifyWeightForAge classifies below -3 SD', () => {
    const cut = whoSdCutoff('weight_for_age', 'boys', 24, -3)!;
    const result = classifyWeightForAge({
      ...base,
      gender: 'male',
      weightKg: cut - 0.2,
    });
    eq(isWhoZoneResult(result) && result.zone, 'below_minus_3');
  });

  await assert('classifyWeightForAge classifies around -2 SD band', () => {
    const m2 = whoSdCutoff('weight_for_age', 'boys', 24, -2)!;
    const m3 = whoSdCutoff('weight_for_age', 'boys', 24, -3)!;
    const mid = (m2 + m3) / 2;
    const result = classifyWeightForAge({
      ...base,
      gender: 'male',
      weightKg: mid,
    });
    eq(isWhoZoneResult(result) && result.zone, 'minus_3_to_minus_2');
  });

  await assert('classifyWeightForAge classifies around +2 SD band', () => {
    const p1 = whoSdCutoff('weight_for_age', 'girls', 24, 1)!;
    const p2 = whoSdCutoff('weight_for_age', 'girls', 24, 2)!;
    const mid = (p1 + p2) / 2;
    const result = classifyWeightForAge({
      ...base,
      gender: 'female',
      weightKg: mid,
    });
    eq(isWhoZoneResult(result) && result.zone, 'plus_1_to_plus_2');
  });

  await assert('classifyWeightForAge classifies above +3 SD', () => {
    const cut = whoSdCutoff('weight_for_age', 'girls', 24, 3)!;
    const result = classifyWeightForAge({
      ...base,
      gender: 'female',
      weightKg: cut + 0.5,
    });
    eq(isWhoZoneResult(result) && result.zone, 'above_plus_3');
  });

  await assert('classifyMuacForAge classifies boy MUAC near median', () => {
    const median = whoSdCutoff('muac_for_age', 'boys', 24, 0)!;
    const result = classifyMuacForAge({
      ...base,
      gender: 'male',
      muacCm: median,
    });
    eq(isWhoZoneResult(result) && result.zone, 'median_to_plus_1');
  });

  await assert('classifyMuacForAge classifies girl MUAC below -2', () => {
    const m2 = whoSdCutoff('muac_for_age', 'girls', 24, -2)!;
    const m3 = whoSdCutoff('muac_for_age', 'girls', 24, -3)!;
    const result = classifyMuacForAge({
      ...base,
      gender: 'female',
      muacCm: (m2 + m3) / 2,
    });
    eq(isWhoZoneResult(result) && result.zone, 'minus_3_to_minus_2');
  });

  await assert('classifyMuacForAge returns age_out_of_range under 3 months', () => {
    const result = classifyMuacForAge({
      dateOfBirth: '2024-01-01',
      screeningDate: '2024-02-01',
      gender: 'male',
      muacCm: 12,
    });
    eq(isWhoZoneResult(result), false);
    if (!isWhoZoneResult(result)) {
      eq(result.unavailableReason, 'age_out_of_range');
    }
  });

  await assert('classifyHeightForAge classifies when height present', () => {
    const median = whoSdCutoff('height_for_age', 'boys', 24, 0)!;
    const result = classifyHeightForAge({
      dateOfBirth: '2022-01-01',
      screeningDate: '2024-01-01',
      gender: 'male',
      heightCm: median,
    });
    eq(isWhoZoneResult(result) && result.zone, 'median_to_plus_1');
  });

  await assert('classifyHeightForAge does not fail when height is null', () => {
    const result = classifyHeightForAge({
      dateOfBirth: '2022-01-01',
      screeningDate: '2024-01-01',
      gender: 'male',
      heightCm: null,
    });
    eq(isWhoZoneResult(result), false);
    if (!isWhoZoneResult(result)) {
      eq(result.unavailableReason, 'missing_measurement');
    }
  });

  await assert('getWhoZonePresentation returns centralized WHO colors', () => {
    const severeBand = getWhoZonePresentation('below_minus_3');
    const greenBand = getWhoZonePresentation('median_to_plus_1');
    if (!/^#/.test(severeBand.color)) throw new Error('expected hex color');
    if (!/^#/.test(greenBand.color)) throw new Error('expected hex color');
    if (severeBand.color === greenBand.color) throw new Error('expected distinct colors');
  });

  console.log('\nAll who-growth specs passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
