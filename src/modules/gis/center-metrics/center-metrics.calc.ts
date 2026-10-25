/**
 * Pure aggregation for the center metrics map — no Prisma, unit-testable.
 * Inputs are already scoped; outputs carry per-center totals only (no child rows).
 */
import { classifyHeightForAge } from '../../nutrition/who/classify';
import { toDateOnlyString } from '../../nutrition/who/concern';
import { isWhoConcernZone, isWhoZoneResult } from '../../nutrition/who/types';
import type { CenterMetricsItemDto } from './center-metrics-response.dto';

/** Below this many classifiable children a center's stunting rate is suppressed (small-n noise). */
export const STUNTING_MIN_SCREENED = 10;

export type HeightScreeningRow = {
  centerId: string;
  dateOfBirth: Date | string | null;
  gender: string | null;
  screeningDate: Date | string | null;
  heightCm: number | null;
};

export type StuntingTally = { screened: number; stunted: number };

/**
 * One row per child (latest height measurement in range). Rows that cannot be
 * classified (missing DOB, out-of-range age, invalid height) are excluded from the denominator.
 */
export function tallyStuntingByCenter(rows: HeightScreeningRow[]): Map<string, StuntingTally> {
  const tallies = new Map<string, StuntingTally>();
  for (const row of rows) {
    const result = classifyHeightForAge({
      dateOfBirth: toDateOnlyString(row.dateOfBirth),
      gender: row.gender,
      screeningDate: toDateOnlyString(row.screeningDate),
      heightCm: row.heightCm,
    });
    if (!isWhoZoneResult(result)) continue;
    const tally = tallies.get(row.centerId) ?? { screened: 0, stunted: 0 };
    tally.screened += 1;
    if (isWhoConcernZone(result.zone)) tally.stunted += 1;
    tallies.set(row.centerId, tally);
  }
  return tallies;
}

export function stuntingRate(tally: StuntingTally | undefined): number | null {
  if (!tally || tally.screened < STUNTING_MIN_SCREENED) return null;
  return roundPercent(tally.stunted, tally.screened);
}

export function roundPercent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export function isUsableCoordinate(lat: number | null, lng: number | null): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export type CenterMetricsInputs = {
  centers: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
  }>;
  enrolledByCenter: Map<string, number>;
  presentByCenter: Map<string, number>;
  absentByCenter: Map<string, number>;
  selfEvalByCenter: Map<
    string,
    { percent: number | null; rank: string | null; date: string | null }
  >;
  stuntingByCenter: Map<string, StuntingTally>;
};

export function buildCenterMetricItems(inputs: CenterMetricsInputs): {
  items: CenterMetricsItemDto[];
  unmappedCount: number;
} {
  const items: CenterMetricsItemDto[] = [];
  let unmappedCount = 0;

  for (const c of inputs.centers) {
    if (!isUsableCoordinate(c.latitude, c.longitude)) {
      unmappedCount += 1;
      continue;
    }
    const present = inputs.presentByCenter.get(c.id) ?? 0;
    const absent = inputs.absentByCenter.get(c.id) ?? 0;
    const selfEval = inputs.selfEvalByCenter.get(c.id);
    const stunting = inputs.stuntingByCenter.get(c.id);
    items.push({
      centerId: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      latitude: c.latitude as number,
      longitude: c.longitude as number,
      enrolledChildren: inputs.enrolledByCenter.get(c.id) ?? 0,
      attendanceRate: roundPercent(present, present + absent),
      attendanceRecords: present + absent,
      selfEvalPercent: selfEval?.percent ?? null,
      selfEvalRank: selfEval?.rank ?? null,
      selfEvalDate: selfEval?.date ?? null,
      stuntingRate: stuntingRate(stunting),
      stuntingScreened: stunting?.screened ?? 0,
    });
  }

  return { items, unmappedCount };
}
