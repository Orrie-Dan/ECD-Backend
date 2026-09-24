import { classifyWhoGrowth } from './classify';
import { WHO_INDICATOR_LABEL_EN, WHO_ZONE_LABEL_EN } from './presentation';
import {
  isWhoConcernZone,
  isWhoZoneResult,
  type WhoClassification,
  type WhoIndicator,
  type WhoZone,
  type WhoZoneResult,
} from './types';

export function toDateOnlyString(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const day = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

export interface WhoConcernHit {
  indicator: WhoIndicator;
  zone: WhoZone;
  zScore: number;
  label: string;
}

/** Collect WHO indicators in undernutrition concern bands (< −2 SD). */
export function collectWhoConcerns(input: {
  dateOfBirth: Date | string | null | undefined;
  gender: string | null | undefined;
  screeningDate: Date | string | null | undefined;
  weightKg?: number | null;
  heightCm?: number | null;
  muacCm?: number | null;
}): WhoConcernHit[] {
  const dateOfBirth = toDateOnlyString(input.dateOfBirth);
  const screeningDate = toDateOnlyString(input.screeningDate);
  const growth = classifyWhoGrowth({
    dateOfBirth,
    gender: input.gender,
    screeningDate,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    muacCm: input.muacCm,
  });

  const hits: WhoConcernHit[] = [];
  for (const result of [growth.weightForAge, growth.heightForAge, growth.muacForAge]) {
    if (isWhoZoneResult(result) && isWhoConcernZone(result.zone)) {
      hits.push({
        indicator: result.indicator,
        zone: result.zone,
        zScore: result.zScore,
        label: `${WHO_INDICATOR_LABEL_EN[result.indicator]} ${WHO_ZONE_LABEL_EN[result.zone]}`,
      });
    }
  }
  return hits;
}

export function whoZoneOrNull(result: WhoClassification): WhoZone | null {
  return isWhoZoneResult(result) ? result.zone : null;
}

export function emptyWhoZoneCounts(): Record<WhoZone | 'unavailable', number> {
  return {
    below_minus_3: 0,
    minus_3_to_minus_2: 0,
    minus_2_to_minus_1: 0,
    minus_1_to_median: 0,
    median_to_plus_1: 0,
    plus_1_to_plus_2: 0,
    plus_2_to_plus_3: 0,
    above_plus_3: 0,
    unavailable: 0,
  };
}

export function bumpWhoZoneCount(
  counts: Record<WhoZone | 'unavailable', number>,
  result: WhoClassification,
): void {
  if (isWhoZoneResult(result)) {
    counts[result.zone] += 1;
  } else {
    counts.unavailable += 1;
  }
}

export type WhoZoneCounts = Record<WhoZone | 'unavailable', number>;

/** Worst undernutrition concern zone among hits (below_minus_3 wins). */
export function worstWhoConcernZone(hits: WhoConcernHit[]): WhoZone | null {
  if (hits.some((h) => h.zone === 'below_minus_3')) return 'below_minus_3';
  if (hits.some((h) => h.zone === 'minus_3_to_minus_2')) return 'minus_3_to_minus_2';
  return null;
}

/**
 * Compatibility remap for legacy severe/moderate/normal dashboard fields.
 * NOT a combined clinical score — exclusive bands from any WHO indicator:
 * - severe = any below_minus_3
 * - moderate = any minus_3_to_minus_2 and no below_minus_3
 * - normal = remaining with ≥1 available zone
 * - unavailable = no classifiable zone on any indicator
 */
export type WhoScreeningCompatBand = 'severe' | 'moderate' | 'normal' | 'unavailable';

export function screeningCompatBand(input: {
  dateOfBirth: Date | string | null | undefined;
  gender: string | null | undefined;
  screeningDate: Date | string | null | undefined;
  weightKg?: number | null;
  heightCm?: number | null;
  muacCm?: number | null;
}): WhoScreeningCompatBand {
  const growth = classifyWhoGrowth({
    dateOfBirth: toDateOnlyString(input.dateOfBirth),
    gender: input.gender,
    screeningDate: toDateOnlyString(input.screeningDate),
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    muacCm: input.muacCm,
  });

  const zones: WhoZone[] = [];
  for (const result of [growth.weightForAge, growth.heightForAge, growth.muacForAge]) {
    if (isWhoZoneResult(result)) zones.push(result.zone);
  }
  if (zones.length === 0) return 'unavailable';
  if (zones.some((z) => z === 'below_minus_3')) return 'severe';
  if (zones.some((z) => z === 'minus_3_to_minus_2')) return 'moderate';
  return 'normal';
}

export interface WhoScreeningAggregate {
  screenings: number;
  weightForAgeZones: WhoZoneCounts;
  heightForAgeZones: WhoZoneCounts;
  muacForAgeZones: WhoZoneCounts;
  /** Compat bridge fields — see screeningCompatBand. */
  severe: number;
  moderate: number;
  atRisk: number;
  normal: number;
}

export function aggregateWhoScreenings(
  rows: Array<{
    dateOfBirth: Date | string | null | undefined;
    gender: string | null | undefined;
    screeningDate: Date | string | null | undefined;
    weightKg?: number | null;
    heightCm?: number | null;
    muacCm?: number | null;
  }>,
): WhoScreeningAggregate {
  const weightForAgeZones = emptyWhoZoneCounts();
  const heightForAgeZones = emptyWhoZoneCounts();
  const muacForAgeZones = emptyWhoZoneCounts();
  let severe = 0;
  let moderate = 0;
  let normal = 0;

  for (const row of rows) {
    const growth = classifyWhoGrowth({
      dateOfBirth: toDateOnlyString(row.dateOfBirth),
      gender: row.gender,
      screeningDate: toDateOnlyString(row.screeningDate),
      weightKg: row.weightKg,
      heightCm: row.heightCm,
      muacCm: row.muacCm,
    });
    bumpWhoZoneCount(weightForAgeZones, growth.weightForAge);
    bumpWhoZoneCount(heightForAgeZones, growth.heightForAge);
    bumpWhoZoneCount(muacForAgeZones, growth.muacForAge);

    const band = screeningCompatBand(row);
    if (band === 'severe') severe += 1;
    else if (band === 'moderate') moderate += 1;
    else if (band === 'normal') normal += 1;
  }

  return {
    screenings: rows.length,
    weightForAgeZones,
    heightForAgeZones,
    muacForAgeZones,
    severe,
    moderate,
    atRisk: 0,
    normal,
  };
}

export type { WhoZoneResult };
