import type { WhoLmsPoint, WhoSex } from './types';
import weightForAge from './weight-for-age.json';
import heightForAge from './height-for-age.json';
import muacForAge from './muac-for-age.json';

export interface WhoReferenceTable {
  indicator: string;
  unit: 'kg' | 'cm';
  ageMonthsMin: number;
  ageMonthsMax: number;
  boys: Record<string, WhoLmsPoint>;
  girls: Record<string, WhoLmsPoint>;
  source: string;
  version: string;
}

export const WHO_WEIGHT_FOR_AGE = weightForAge as WhoReferenceTable;
export const WHO_HEIGHT_FOR_AGE = heightForAge as WhoReferenceTable;
export const WHO_MUAC_FOR_AGE = muacForAge as WhoReferenceTable;

export const WHO_SOURCE_CITATION =
  'WHO Child Growth Standards (2006 / MGRS). LMS parameters from official WHO standards (RCPCH WHO2006.csv sets 1–2).';

export function lookupLms(
  table: WhoReferenceTable,
  sex: WhoSex,
  ageMonths: number,
): WhoLmsPoint | null {
  if (!Number.isFinite(ageMonths)) return null;
  const month = Math.trunc(ageMonths);
  if (month < table.ageMonthsMin || month > table.ageMonthsMax) return null;
  const series = sex === 'boys' ? table.boys : table.girls;
  return series[String(month)] ?? null;
}
