/**
 * SELF-EVAL-ALIGN-05A — Canonical facility routing + tool availability (backend).
 *
 * Center.facilityType is authoritative for new official self-assessments.
 * Never default to daycare. Supportive supervision keeps explicit selection.
 */

import { BadRequestException } from '@nestjs/common';
import { getRegisteredCatalog } from './catalog-registry';
import {
  OFFICIAL_CATALOG_VERSION,
  type AssessmentCatalogAssessmentType,
} from './catalog-versions';
import type { SelfEvalFacilityChecklist } from './self-eval-catalog';

export const SELF_EVAL_FACILITY_TYPE_IDS = [
  'daycare',
  'ecd_3_5',
  'home_based',
  'community_based',
] as const;

export type SelfEvalFacilityTypeId = (typeof SELF_EVAL_FACILITY_TYPE_IDS)[number];

/**
 * Center facilityType enum values are identical to catalog facilityTypeId.
 * Identity map — kept explicit for future remaps.
 */
export const CENTER_FACILITY_TYPE_TO_CATALOG: Readonly<
  Record<SelfEvalFacilityTypeId, SelfEvalFacilityTypeId>
> = Object.freeze({
  daycare: 'daycare',
  home_based: 'home_based',
  community_based: 'community_based',
  ecd_3_5: 'ecd_3_5',
});

export function canonicalizeSelfEvalFacilityTypeId(
  raw: string | null | undefined,
): SelfEvalFacilityTypeId | null {
  if (raw == null) return null;
  const id = raw.trim();
  if (!id) return null;
  return (SELF_EVAL_FACILITY_TYPE_IDS as readonly string[]).includes(id)
    ? (id as SelfEvalFacilityTypeId)
    : null;
}

export type ResolveSelfEvaluationFacilityInput = {
  explicitFacilityTypeId?: string | null;
  centerFacilityType?: string | null;
};

export function resolveSelfEvaluationFacility(
  input: ResolveSelfEvaluationFacilityInput,
): { facilityTypeId: SelfEvalFacilityTypeId; source: 'explicit' | 'center' } {
  if (input.centerFacilityType != null && String(input.centerFacilityType).trim() !== '') {
    const fromCenter = canonicalizeSelfEvalFacilityTypeId(input.centerFacilityType);
    if (!fromCenter) {
      throw new BadRequestException(
        `Unknown center facility classification "${input.centerFacilityType}"`,
      );
    }
    const mapped = CENTER_FACILITY_TYPE_TO_CATALOG[fromCenter];
    return { facilityTypeId: mapped, source: 'center' };
  }

  const fromExplicit = canonicalizeSelfEvalFacilityTypeId(input.explicitFacilityTypeId);
  if (fromExplicit) {
    return { facilityTypeId: fromExplicit, source: 'explicit' };
  }

  throw new BadRequestException(
    'Self-evaluation facility type could not be resolved from center or explicit selection',
  );
}

/**
 * ALIGN-05A — Enforce center.facilityType against request for official self-assessment.
 *
 * Legacy 2024.2-weighted drafts keep their pinned facility identity (skip mismatch).
 * New 2024.3-official work requires a configured center type and matching request.
 */
export function assertCenterFacilityMatchesSelfEval(input: {
  assessmentType: AssessmentCatalogAssessmentType;
  standardsVersion: string;
  centerFacilityType: string | null | undefined;
  requestFacilityTypeId: string;
  /** When true, existing draft is pinned to a pre-official catalog — skip center match. */
  legacyPinnedDraft?: boolean;
}): SelfEvalFacilityTypeId {
  if (input.assessmentType !== 'self_assessment') {
    const explicit = canonicalizeSelfEvalFacilityTypeId(input.requestFacilityTypeId);
    if (!explicit) {
      throw new BadRequestException(`Unknown facilityTypeId "${input.requestFacilityTypeId}"`);
    }
    return explicit;
  }

  if (input.legacyPinnedDraft) {
    const pinned = canonicalizeSelfEvalFacilityTypeId(input.requestFacilityTypeId);
    if (!pinned) {
      throw new BadRequestException(`Unknown facilityTypeId "${input.requestFacilityTypeId}"`);
    }
    return pinned;
  }

  const isOfficial =
    input.standardsVersion === OFFICIAL_CATALOG_VERSION ||
    input.standardsVersion.startsWith(`${OFFICIAL_CATALOG_VERSION}/`);

  if (!isOfficial) {
    // Non-official (e.g. new 2024.2) — still prefer center when present.
    if (input.centerFacilityType != null && String(input.centerFacilityType).trim() !== '') {
      const fromCenter = resolveSelfEvaluationFacility({
        centerFacilityType: input.centerFacilityType,
      });
      const fromRequest = canonicalizeSelfEvalFacilityTypeId(input.requestFacilityTypeId);
      if (fromRequest && fromRequest !== fromCenter.facilityTypeId) {
        throw new BadRequestException(
          `facilityTypeId "${input.requestFacilityTypeId}" does not match center facility type "${fromCenter.facilityTypeId}"`,
        );
      }
      return fromCenter.facilityTypeId;
    }
    return resolveSelfEvaluationFacility({
      explicitFacilityTypeId: input.requestFacilityTypeId,
    }).facilityTypeId;
  }

  // Official 2024.3: center is authoritative.
  if (input.centerFacilityType == null || String(input.centerFacilityType).trim() === '') {
    throw new BadRequestException(
      'ECD center facility type must be configured before starting self-evaluation',
    );
  }

  const fromCenter = resolveSelfEvaluationFacility({
    centerFacilityType: input.centerFacilityType,
  });
  const fromRequest = canonicalizeSelfEvalFacilityTypeId(input.requestFacilityTypeId);
  if (fromRequest && fromRequest !== fromCenter.facilityTypeId) {
    throw new BadRequestException(
      `facilityTypeId "${input.requestFacilityTypeId}" does not match center facility type "${fromCenter.facilityTypeId}"`,
    );
  }
  return fromCenter.facilityTypeId;
}

export type SelfEvalToolUnavailableReason =
  | 'unavailable_pending_source_confirmation'
  | 'unknown_facility'
  | 'unknown_catalog'
  | 'not_registered_for_assessment_type'
  | 'center_facility_type_required';

export type SelfEvalToolAvailability =
  | { available: true; facilityTypeId: SelfEvalFacilityTypeId; standardsVersion: string }
  | {
      available: false;
      facilityTypeId: string;
      standardsVersion: string;
      reason: SelfEvalToolUnavailableReason;
    };

/**
 * Production gate for creating/submitting self-assessments against a catalog tool.
 * Home-Based remains registered under 2024.3-official but blocked pending source confirmation.
 */
export function getSelfEvaluationToolAvailability(input: {
  assessmentType: AssessmentCatalogAssessmentType;
  standardsVersion: string;
  facilityTypeId: string;
}): SelfEvalToolAvailability {
  const { assessmentType, standardsVersion, facilityTypeId } = input;
  const canonical = canonicalizeSelfEvalFacilityTypeId(facilityTypeId);

  if (!canonical) {
    return {
      available: false,
      facilityTypeId,
      standardsVersion,
      reason: 'unknown_facility',
    };
  }

  const catalog = getRegisteredCatalog(assessmentType, standardsVersion);
  if (!catalog) {
    return {
      available: false,
      facilityTypeId: canonical,
      standardsVersion,
      reason: 'not_registered_for_assessment_type',
    };
  }

  const checklist = catalog.facilityTypes.find(
    (f: SelfEvalFacilityChecklist) => f.id === canonical,
  );
  if (!checklist) {
    return {
      available: false,
      facilityTypeId: canonical,
      standardsVersion,
      reason: 'unknown_catalog',
    };
  }

  return {
    available: true,
    facilityTypeId: canonical,
    standardsVersion,
  };
}

export function assertSelfEvaluationToolAvailable(input: {
  assessmentType: AssessmentCatalogAssessmentType;
  standardsVersion: string;
  facilityTypeId: string;
}): void {
  const availability = getSelfEvaluationToolAvailability(input);
  if (availability.available) return;

  const messages: Record<SelfEvalToolUnavailableReason, string> = {
    unavailable_pending_source_confirmation:
      'Home-Based self-evaluation is awaiting final configuration confirmation and cannot be saved or submitted',
    unknown_facility: `Unknown facilityTypeId "${input.facilityTypeId}"`,
    unknown_catalog: `Facility "${input.facilityTypeId}" is not in catalog ${input.standardsVersion}`,
    not_registered_for_assessment_type: `No catalog registered for ${input.assessmentType}/${input.standardsVersion}`,
    center_facility_type_required:
      'ECD center facility type must be configured before starting self-evaluation',
  };
  throw new BadRequestException(messages[availability.reason]);
}
