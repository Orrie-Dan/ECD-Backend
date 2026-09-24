/**
 * WHO Child Growth Standards — local LMS reference + zone helpers.
 *
 * Source: WHO 2006 / MGRS (https://www.who.int/tools/child-growth-standards/standards)
 * LMS tables extracted from RCPCH growth-references WHO2006.csv (sets 1 & 2).
 *
 * Ported from ECD frontend NUTR-WHO-02 for backend parity.
 * Do NOT invent a second algorithm — keep in sync with frontend src/lib/nutrition/who.
 */

export type WhoSex = 'boys' | 'girls';

export type WhoIndicator = 'weight_for_age' | 'height_for_age' | 'muac_for_age';

/** SD bands relative to the WHO LMS median for age/sex. */
export type WhoZone =
  | 'below_minus_3'
  | 'minus_3_to_minus_2'
  | 'minus_2_to_minus_1'
  | 'minus_1_to_median'
  | 'median_to_plus_1'
  | 'plus_1_to_plus_2'
  | 'plus_2_to_plus_3'
  | 'above_plus_3';

export type WhoUnavailableReason =
  | 'missing_measurement'
  | 'invalid_measurement'
  | 'missing_dob'
  | 'invalid_dob'
  | 'screening_before_dob'
  | 'unsupported_sex'
  | 'age_out_of_range'
  | 'missing_reference';

export interface WhoLmsPoint {
  L: number;
  M: number;
  S: number;
}

export interface WhoZoneResult {
  indicator: WhoIndicator;
  zone: WhoZone;
  zScore: number;
  measurement: number;
  unit: 'kg' | 'cm';
  ageMonths: number;
  sex: WhoSex;
}

export interface WhoUnavailableResult {
  indicator: WhoIndicator;
  zone: null;
  unavailableReason: WhoUnavailableReason;
  measurement?: number | null;
  unit?: 'kg' | 'cm';
  ageMonths?: number | null;
  sex?: WhoSex | null;
}

export type WhoClassification = WhoZoneResult | WhoUnavailableResult;

export function isWhoZoneResult(result: WhoClassification): result is WhoZoneResult {
  return result.zone != null;
}

/** WHO undernutrition concern bands (< −2 SD). Not a referral rule. */
export const WHO_CONCERN_ZONES: readonly WhoZone[] = [
  'below_minus_3',
  'minus_3_to_minus_2',
] as const;

export function isWhoConcernZone(zone: WhoZone | null | undefined): boolean {
  return zone != null && (WHO_CONCERN_ZONES as readonly string[]).includes(zone);
}
