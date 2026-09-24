import type { WhoUnavailableReason, WhoZone } from './types';

export interface WhoZonePresentation {
  zone: WhoZone;
  /** Short English key for tests / fallbacks */
  labelKey: WhoZone;
  /** Hex aligned to WHO SD-band chart presentation */
  color: string;
  backgroundColor: string;
}

/**
 * WHO SD-band presentation colors (growth-chart style), centralized.
 * Keep in sync with ECD frontend src/lib/nutrition/who/presentation.ts.
 */
const WHO_ZONE_PRESENTATION: Record<WhoZone, WhoZonePresentation> = {
  below_minus_3: {
    zone: 'below_minus_3',
    labelKey: 'below_minus_3',
    color: '#912018',
    backgroundColor: '#fef3f2',
  },
  minus_3_to_minus_2: {
    zone: 'minus_3_to_minus_2',
    labelKey: 'minus_3_to_minus_2',
    color: '#b42318',
    backgroundColor: '#fef3f2',
  },
  minus_2_to_minus_1: {
    zone: 'minus_2_to_minus_1',
    labelKey: 'minus_2_to_minus_1',
    color: '#b45309',
    backgroundColor: '#fffbeb',
  },
  minus_1_to_median: {
    zone: 'minus_1_to_median',
    labelKey: 'minus_1_to_median',
    color: '#15803d',
    backgroundColor: '#ecfdf3',
  },
  median_to_plus_1: {
    zone: 'median_to_plus_1',
    labelKey: 'median_to_plus_1',
    color: '#166534',
    backgroundColor: '#ecfdf3',
  },
  plus_1_to_plus_2: {
    zone: 'plus_1_to_plus_2',
    labelKey: 'plus_1_to_plus_2',
    color: '#c47d1a',
    backgroundColor: '#fdf4e8',
  },
  plus_2_to_plus_3: {
    zone: 'plus_2_to_plus_3',
    labelKey: 'plus_2_to_plus_3',
    color: '#b45309',
    backgroundColor: '#fffbeb',
  },
  above_plus_3: {
    zone: 'above_plus_3',
    labelKey: 'above_plus_3',
    color: '#912018',
    backgroundColor: '#fef3f2',
  },
};

export function getWhoZonePresentation(zone: WhoZone): WhoZonePresentation {
  return WHO_ZONE_PRESENTATION[zone];
}

export function whoUnavailableLabelKey(reason: WhoUnavailableReason): string {
  return `unavailable_${reason}`;
}

/** English labels for zones (alerts / exports). */
export const WHO_ZONE_LABEL_EN: Record<WhoZone, string> = {
  below_minus_3: 'Below -3 SD',
  minus_3_to_minus_2: '-3 to -2 SD',
  minus_2_to_minus_1: '-2 to -1 SD',
  minus_1_to_median: '-1 SD to Median',
  median_to_plus_1: 'Median to +1 SD',
  plus_1_to_plus_2: '+1 to +2 SD',
  plus_2_to_plus_3: '+2 to +3 SD',
  above_plus_3: 'Above +3 SD',
};

export const WHO_INDICATOR_LABEL_EN: Record<
  'weight_for_age' | 'height_for_age' | 'muac_for_age',
  string
> = {
  weight_for_age: 'Weight-for-age',
  height_for_age: 'Height/length-for-age',
  muac_for_age: 'MUAC-for-age',
};
