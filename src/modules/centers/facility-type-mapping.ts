/**
 * SELF-EVAL-ALIGN-05A — Survey123 `settings_types` → canonical EcdFacilityType.
 *
 * Only deterministic mappings are applied. Unknown / ambiguous values return null.
 * Never default to daycare.
 */

export const ECD_FACILITY_TYPE_IDS = [
  'daycare',
  'home_based',
  'community_based',
  'ecd_3_5',
] as const;

export type EcdFacilityTypeId = (typeof ECD_FACILITY_TYPE_IDS)[number];

/**
 * Exact Survey123 `ecd_mapping_form.settings_types` values with documented
 * 1:1 mapping to official self-evaluation facilityTypeId.
 *
 * Official tools:
 *   A Daycare (Creches)           → daycare
 *   B Home-Based ECD              → home_based
 *   C Community-Based ECD         → community_based
 *   D School-Based and Model ECD  → ecd_3_5
 *
 * Intentionally unmapped (ambiguous / no official tool binding):
 *   Centre Based, Faith-based, Market based, Mobile crèches,
 *   ECD in emergency settings, Cross-border ECD, ECD in prison
 */
export const SETTINGS_TYPES_TO_FACILITY_TYPE: Readonly<
  Record<string, EcdFacilityTypeId>
> = Object.freeze({
  'Home based ECD': 'home_based',
  'Home Based ECD': 'home_based',
  'Community based ECD centre': 'community_based',
  'Community Based ECD': 'community_based',
  'School based ECD Centre': 'ecd_3_5',
  'School Based ECD': 'ecd_3_5',
  'Model ECD centre': 'ecd_3_5',
  'Model ECD': 'ecd_3_5',
});

export type MapSettingsTypesResult =
  | { facilityType: EcdFacilityTypeId; sourceValue: string; mapped: true }
  | { facilityType: null; sourceValue: string | null; mapped: false; reason: 'empty' | 'unmapped' };

/**
 * Map a Survey123 settings_types value to canonical facility type.
 * Unknown values → null (never daycare fallback).
 */
export function mapSettingsTypesToFacilityType(
  raw: string | null | undefined,
): MapSettingsTypesResult {
  if (raw == null) {
    return { facilityType: null, sourceValue: null, mapped: false, reason: 'empty' };
  }
  const sourceValue = String(raw).trim();
  if (!sourceValue) {
    return { facilityType: null, sourceValue: '', mapped: false, reason: 'empty' };
  }
  const facilityType = SETTINGS_TYPES_TO_FACILITY_TYPE[sourceValue];
  if (facilityType) {
    return { facilityType, sourceValue, mapped: true };
  }
  return { facilityType: null, sourceValue, mapped: false, reason: 'unmapped' };
}

export function isEcdFacilityTypeId(raw: string | null | undefined): raw is EcdFacilityTypeId {
  if (raw == null) return false;
  return (ECD_FACILITY_TYPE_IDS as readonly string[]).includes(raw);
}
