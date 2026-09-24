import type { WhoLmsPoint, WhoZone } from './types';

/** WHO LMS → z-score (Cole & Green / WHO anthro). */
export function zScoreFromLms(measurement: number, lms: WhoLmsPoint): number | null {
  if (!Number.isFinite(measurement) || measurement <= 0) return null;
  const { L, M, S } = lms;
  if (!Number.isFinite(L) || !Number.isFinite(M) || !Number.isFinite(S) || M <= 0 || S <= 0) {
    return null;
  }

  if (Math.abs(L) < 1e-9) {
    return Math.log(measurement / M) / S;
  }
  return (Math.pow(measurement / M, L) - 1) / (L * S);
}

/** Value on the LMS curve at a given z (for tests / SD boundary checks). */
export function measurementAtZ(z: number, lms: WhoLmsPoint): number | null {
  const { L, M, S } = lms;
  if (!Number.isFinite(z) || !Number.isFinite(L) || !Number.isFinite(M) || !Number.isFinite(S)) {
    return null;
  }
  if (M <= 0 || S <= 0) return null;
  if (Math.abs(L) < 1e-9) {
    return M * Math.exp(S * z);
  }
  const base = 1 + L * S * z;
  if (base <= 0) return null;
  return M * Math.pow(base, 1 / L);
}

/**
 * Map continuous z-score into WHO SD presentation bands.
 * Boundaries use half-open intervals toward +∞ except the top band.
 */
export function zoneFromZScore(z: number): WhoZone {
  if (z < -3) return 'below_minus_3';
  if (z < -2) return 'minus_3_to_minus_2';
  if (z < -1) return 'minus_2_to_minus_1';
  if (z < 0) return 'minus_1_to_median';
  if (z < 1) return 'median_to_plus_1';
  if (z < 2) return 'plus_1_to_plus_2';
  if (z < 3) return 'plus_2_to_plus_3';
  return 'above_plus_3';
}
