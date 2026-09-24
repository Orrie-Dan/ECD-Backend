import { getAgeInMonthsAtDate } from './age';
import { measurementAtZ, zScoreFromLms, zoneFromZScore } from './lms';
import {
  WHO_HEIGHT_FOR_AGE,
  WHO_MUAC_FOR_AGE,
  WHO_WEIGHT_FOR_AGE,
  lookupLms,
  type WhoReferenceTable,
} from './reference';
import { toWhoSex } from './sex';
import type {
  WhoClassification,
  WhoIndicator,
  WhoUnavailableReason,
  WhoUnavailableResult,
  WhoZoneResult,
} from './types';

export interface WhoClassifyInput {
  dateOfBirth: string | null | undefined;
  gender: string | null | undefined;
  screeningDate: string | null | undefined;
  weightKg?: number | null;
  heightCm?: number | null;
  muacCm?: number | null;
}

function unavailable(
  indicator: WhoIndicator,
  reason: WhoUnavailableReason,
  extras: Omit<Partial<WhoUnavailableResult>, 'indicator' | 'zone' | 'unavailableReason'> = {},
): WhoUnavailableResult {
  return {
    indicator,
    zone: null,
    unavailableReason: reason,
    ...extras,
  };
}

function classifyAgainstTable(
  indicator: WhoIndicator,
  table: WhoReferenceTable,
  measurement: number | null | undefined,
  unit: 'kg' | 'cm',
  dateOfBirth: string | null | undefined,
  gender: string | null | undefined,
  screeningDate: string | null | undefined,
): WhoClassification {
  if (measurement == null || measurement === undefined) {
    return unavailable(indicator, 'missing_measurement', { unit });
  }
  if (!Number.isFinite(measurement) || measurement <= 0) {
    return unavailable(indicator, 'invalid_measurement', {
      measurement,
      unit,
    });
  }

  const sex = toWhoSex(gender);
  if (!sex) {
    return unavailable(indicator, 'unsupported_sex', { measurement, unit });
  }

  if (!dateOfBirth || !String(dateOfBirth).trim()) {
    return unavailable(indicator, 'missing_dob', { measurement, unit, sex });
  }

  const dobParsed = String(dateOfBirth).slice(0, 10);
  const screenParsed = String(screeningDate ?? '').slice(0, 10);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(dobParsed)) {
    return unavailable(indicator, 'invalid_dob', { measurement, unit, sex });
  }
  if (!dateRe.test(screenParsed)) {
    return unavailable(indicator, 'invalid_dob', { measurement, unit, sex });
  }
  if (screenParsed < dobParsed) {
    return unavailable(indicator, 'screening_before_dob', {
      measurement,
      unit,
      sex,
    });
  }

  const ageMonths = getAgeInMonthsAtDate(dateOfBirth, screeningDate);
  if (ageMonths == null) {
    return unavailable(indicator, 'invalid_dob', { measurement, unit, sex });
  }

  if (ageMonths < table.ageMonthsMin || ageMonths > table.ageMonthsMax) {
    return unavailable(indicator, 'age_out_of_range', {
      measurement,
      unit,
      sex,
      ageMonths,
    });
  }

  const lms = lookupLms(table, sex, ageMonths);
  if (!lms) {
    return unavailable(indicator, 'missing_reference', {
      measurement,
      unit,
      sex,
      ageMonths,
    });
  }

  const z = zScoreFromLms(measurement, lms);
  if (z == null || !Number.isFinite(z)) {
    return unavailable(indicator, 'invalid_measurement', {
      measurement,
      unit,
      sex,
      ageMonths,
    });
  }

  const result: WhoZoneResult = {
    indicator,
    zone: zoneFromZScore(z),
    zScore: Number(z.toFixed(2)),
    measurement,
    unit,
    ageMonths,
    sex,
  };
  return result;
}

export function classifyWeightForAge(input: WhoClassifyInput): WhoClassification {
  return classifyAgainstTable(
    'weight_for_age',
    WHO_WEIGHT_FOR_AGE,
    input.weightKg,
    'kg',
    input.dateOfBirth,
    input.gender,
    input.screeningDate,
  );
}

/**
 * Length/height-for-age.
 *
 * Limitation: ECD stores only `heightCm` and does not record whether the
 * measurement was recumbent length or standing height. WHO uses length for
 * younger children and height for older children. We apply the age-matched
 * WHO length/height-for-age LMS row without adjusting historical values.
 */
export function classifyHeightForAge(input: WhoClassifyInput): WhoClassification {
  return classifyAgainstTable(
    'height_for_age',
    WHO_HEIGHT_FOR_AGE,
    input.heightCm,
    'cm',
    input.dateOfBirth,
    input.gender,
    input.screeningDate,
  );
}

export function classifyMuacForAge(input: WhoClassifyInput): WhoClassification {
  return classifyAgainstTable(
    'muac_for_age',
    WHO_MUAC_FOR_AGE,
    input.muacCm,
    'cm',
    input.dateOfBirth,
    input.gender,
    input.screeningDate,
  );
}

export function classifyWhoGrowth(input: WhoClassifyInput): {
  weightForAge: WhoClassification;
  heightForAge: WhoClassification;
  muacForAge: WhoClassification;
} {
  return {
    weightForAge: classifyWeightForAge(input),
    heightForAge: classifyHeightForAge(input),
    muacForAge: classifyMuacForAge(input),
  };
}

/** Test helper: SD cut-off value for age/sex from LMS. */
export function whoSdCutoff(
  indicator: WhoIndicator,
  sex: 'boys' | 'girls',
  ageMonths: number,
  z: number,
): number | null {
  const table =
    indicator === 'weight_for_age'
      ? WHO_WEIGHT_FOR_AGE
      : indicator === 'height_for_age'
        ? WHO_HEIGHT_FOR_AGE
        : WHO_MUAC_FOR_AGE;
  const lms = lookupLms(table, sex, ageMonths);
  if (!lms) return null;
  return measurementAtZ(z, lms);
}
