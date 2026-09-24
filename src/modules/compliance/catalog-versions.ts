/**
 * Authoritative "current version for new assessments" configuration.
 *
 * ALIGN-03/04 activates the official self-assessment catalog by changing
 * SELF_ASSESSMENT_CURRENT_VERSION only — supportive_supervision stays pinned.
 */

export const INTERIM_WEIGHTED_CATALOG_VERSION = '2024.2-weighted' as const;

/** Official NCDA DOCX instrument (ALIGN-03). Registered under self_assessment only. */
export const OFFICIAL_CATALOG_VERSION = '2024.3-official' as const;

/** Legacy score-only assessments (no reconstructable item catalog in runtime). */
export const LEGACY_SCORE_ONLY_VERSION = '2024.1' as const;

export const SELF_ASSESSMENT_CURRENT_VERSION: string = OFFICIAL_CATALOG_VERSION;

/**
 * Explicit supportive_supervision pin. Same interim catalog content today,
 * but independently configurable so a self-eval upgrade cannot silently
 * change inspection scoring.
 */
export const SUPPORTIVE_SUPERVISION_CURRENT_VERSION: string =
  INTERIM_WEIGHTED_CATALOG_VERSION;

export type AssessmentCatalogAssessmentType =
  | 'self_assessment'
  | 'supportive_supervision';

const currentByType: Record<AssessmentCatalogAssessmentType, string> = {
  self_assessment: SELF_ASSESSMENT_CURRENT_VERSION,
  supportive_supervision: SUPPORTIVE_SUPERVISION_CURRENT_VERSION,
};

let testOverrides: Partial<Record<AssessmentCatalogAssessmentType, string>> | null =
  null;

export function getCurrentCatalogVersion(
  assessmentType: AssessmentCatalogAssessmentType,
): string {
  if (testOverrides?.[assessmentType] != null) {
    return testOverrides[assessmentType]!;
  }
  return currentByType[assessmentType];
}

export function setCurrentCatalogVersionForTests(
  assessmentType: AssessmentCatalogAssessmentType,
  version: string | null,
): void {
  if (version == null) {
    if (testOverrides) {
      delete testOverrides[assessmentType];
      if (Object.keys(testOverrides).length === 0) testOverrides = null;
    }
    return;
  }
  testOverrides = { ...(testOverrides ?? {}), [assessmentType]: version };
}

export function resetCurrentCatalogVersionsForTests(): void {
  testOverrides = null;
}
