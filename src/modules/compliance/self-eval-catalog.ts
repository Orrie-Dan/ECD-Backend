import { BadRequestException } from '@nestjs/common';
import {
  getRegisteredCatalog,
  registerCatalogVersionForTests,
  resetCatalogRegistryForTests,
  unregisterCatalogVersionForTests,
} from './catalog-registry';
import {
  getCurrentCatalogVersion,
  INTERIM_WEIGHTED_CATALOG_VERSION,
  OFFICIAL_CATALOG_VERSION,
  LEGACY_SCORE_ONLY_VERSION,
  resetCurrentCatalogVersionsForTests,
  SELF_ASSESSMENT_CURRENT_VERSION,
  setCurrentCatalogVersionForTests,
  SUPPORTIVE_SUPERVISION_CURRENT_VERSION,
  type AssessmentCatalogAssessmentType,
} from './catalog-versions';

/**
 * Self-evaluation / inspection question identity
 * ---------------------------------------------
 * Frontend checklist IDs (checklists.generated.json) are the stable keys:
 *   daycare  → dc_*
 *   ecd_3_5  → ecd_*
 *
 * Mapping: questionId === EcdStandard.code
 *
 * Catalog selection is explicit:
 *   assessmentType + standardsVersion + facilityTypeId
 * Scoring never decides which version is "current".
 */

export const SELF_EVAL_SCORE_CODE = 'SELF-EVAL-SCORE';

export type SelfEvalSelectionMode = 'all' | 'any';

export interface SelfEvalIndicator {
  id: string;
  label: string;
  maxScore: number;
  /** DOCX table row index for official-catalog traceability (optional). */
  sourceRow?: number;
  /** Original DOCX "#" cell when a numbered OR path was folded into an indicator. */
  sourceNumber?: string;
}

export interface SelfEvalItem {
  id: string;
  number: number;
  text: string;
  maxScore: number;
  indicators: SelfEvalIndicator[];
  selectionMode?: SelfEvalSelectionMode;
}

export interface SelfEvalSection {
  id: string;
  title: string;
  /**
   * Official / printed section maximum from the DOCX S/TOTAL line.
   * When set, scoring uses this as the section ceiling even if sum(item.maxScore)
   * differs (ALIGN-05C Home-Based Section 6).
   */
  subtotalMax: number | null;
  items: SelfEvalItem[];
}

export interface SelfEvalFacilityChecklist {
  id: string;
  title: string;
  version: string;
  grandTotalMax: number | null;
  computedMaxScore: number;
  sectionCount: number;
  itemCount: number;
  sections: SelfEvalSection[];
}

export interface ComplianceRankBand {
  id: 'green' | 'blue' | 'yellow' | 'red';
  minPercent: number;
  maxPercent: number;
  labelRw: string;
}

export interface SelfEvalChecklistCatalog {
  ranks: ComplianceRankBand[];
  facilityTypes: SelfEvalFacilityChecklist[];
}

export interface SelfEvalQuestionDef {
  questionId: string;
  title: string;
  maxScore: number;
  facilityTypeId: string;
  sectionId: string;
  sectionTitle: string;
  questionOrder: number;
  version: string;
}

export interface SelfEvalScorePreview {
  earnedScore: number;
  maxScore: number;
  percent: number;
  rank: ComplianceRankBand['id'];
}

export type AssessmentCatalogIdentity = {
  assessmentType: AssessmentCatalogAssessmentType;
  standardsVersion: string;
  facilityTypeId: string;
};

export {
  getCurrentCatalogVersion,
  INTERIM_WEIGHTED_CATALOG_VERSION,
  OFFICIAL_CATALOG_VERSION,
  LEGACY_SCORE_ONLY_VERSION,
  SELF_ASSESSMENT_CURRENT_VERSION,
  SUPPORTIVE_SUPERVISION_CURRENT_VERSION,
  setCurrentCatalogVersionForTests,
  resetCurrentCatalogVersionsForTests,
  registerCatalogVersionForTests,
  unregisterCatalogVersionForTests,
  resetCatalogRegistryForTests,
};
export type { AssessmentCatalogAssessmentType };

/**
 * Deterministic catalog resolution. Never falls back to "latest".
 */
export function resolveAssessmentCatalog(
  identity: AssessmentCatalogIdentity,
): {
  identity: AssessmentCatalogIdentity;
  catalog: SelfEvalChecklistCatalog;
  checklist: SelfEvalFacilityChecklist;
} {
  const catalog = getRegisteredCatalog(identity.assessmentType, identity.standardsVersion);
  if (!catalog) {
    throw new BadRequestException(
      `Unknown standardsVersion "${identity.standardsVersion}" for ${identity.assessmentType}`,
    );
  }

  const checklist =
    catalog.facilityTypes.find((f) => f.id === identity.facilityTypeId) ?? null;
  if (!checklist) {
    throw new BadRequestException(
      `Unknown facilityTypeId "${identity.facilityTypeId}" for ${identity.assessmentType}/${identity.standardsVersion}`,
    );
  }

  if (checklist.version !== identity.standardsVersion) {
    throw new BadRequestException(
      `Checklist version mismatch: catalog entry is "${checklist.version}"`,
    );
  }

  return { identity, catalog, checklist };
}

/** @deprecated Prefer resolveAssessmentCatalog with explicit identity. */
export function getSelfEvalCatalog(
  assessmentType: AssessmentCatalogAssessmentType = 'self_assessment',
  standardsVersion?: string,
): SelfEvalChecklistCatalog {
  const version = standardsVersion ?? getCurrentCatalogVersion(assessmentType);
  const catalog = getRegisteredCatalog(assessmentType, version);
  if (!catalog) {
    throw new BadRequestException(
      `No catalog registered for ${assessmentType}/${version}`,
    );
  }
  return catalog;
}

/**
 * @deprecated Prefer resolveAssessmentCatalog. When version is omitted, uses
 * current self_assessment version (not a silent cross-type fallback).
 */
export function getFacilityChecklist(
  facilityTypeId: string,
  standardsVersion?: string,
  assessmentType: AssessmentCatalogAssessmentType = 'self_assessment',
): SelfEvalFacilityChecklist | null {
  const version = standardsVersion ?? getCurrentCatalogVersion(assessmentType);
  try {
    return resolveAssessmentCatalog({
      assessmentType,
      standardsVersion: version,
      facilityTypeId,
    }).checklist;
  } catch {
    return null;
  }
}

/**
 * Answerable IDs for a facility: simple items use item.id; multi-indicator
 * items use each indicator.id (matching frontend SelfEvalItemAnswers keys).
 */
export function getAnswerableQuestions(
  facilityTypeId: string,
  standardsVersion?: string,
  assessmentType: AssessmentCatalogAssessmentType = 'self_assessment',
): Map<string, SelfEvalQuestionDef> {
  const version = standardsVersion ?? getCurrentCatalogVersion(assessmentType);
  const map = new Map<string, SelfEvalQuestionDef>();
  let checklist: SelfEvalFacilityChecklist;
  try {
    checklist = resolveAssessmentCatalog({
      assessmentType,
      standardsVersion: version,
      facilityTypeId,
    }).checklist;
  } catch {
    return map;
  }

  let order = 0;
  for (const section of checklist.sections) {
    for (const item of section.items) {
      if (item.indicators.length > 0) {
        for (const indicator of item.indicators) {
          order += 1;
          map.set(indicator.id, {
            questionId: indicator.id,
            title: indicator.label || item.text,
            maxScore: indicator.maxScore,
            facilityTypeId: checklist.id,
            sectionId: section.id,
            sectionTitle: section.title,
            questionOrder: order,
            version: checklist.version,
          });
        }
      } else {
        order += 1;
        map.set(item.id, {
          questionId: item.id,
          title: item.text,
          maxScore: item.maxScore,
          facilityTypeId: checklist.id,
          sectionId: section.id,
          sectionTitle: section.title,
          questionOrder: order,
          version: checklist.version,
        });
      }
    }
  }

  return map;
}

function scoreItem(item: SelfEvalItem, answers: Record<string, boolean>): number {
  if (item.indicators.length > 0) {
    if (item.selectionMode === 'any') {
      const anyMet = item.indicators.some((ind) => answers[ind.id] === true);
      return anyMet ? item.maxScore : 0;
    }
    return item.indicators.reduce(
      (sum, ind) => sum + (answers[ind.id] === true ? ind.maxScore : 0),
      0,
    );
  }
  return answers[item.id] === true ? item.maxScore : 0;
}

function getSectionMaxScore(section: SelfEvalSection): number {
  const weightSum = section.items.reduce((sum, item) => sum + item.maxScore, 0);
  return section.subtotalMax ?? weightSum;
}

function scoreSection(
  section: SelfEvalSection,
  answers: Record<string, boolean>,
): { earned: number; max: number } {
  const rawEarned = section.items.reduce(
    (sum, item) => sum + scoreItem(item, answers),
    0,
  );
  const max = getSectionMaxScore(section);
  // Official printed section maximum governs (ALIGN-05C).
  return { earned: Math.min(rawEarned, max), max };
}

export function encodeSelfEvalStandardsVersion(version: string, facilityTypeId: string): string {
  return `${version}/${facilityTypeId}`;
}

export function parseSelfEvalStandardsVersion(stored: string): {
  version: string;
  facilityTypeId: string;
} {
  const idx = stored.lastIndexOf('/');
  if (idx <= 0) {
    return { version: stored, facilityTypeId: '' };
  }
  return {
    version: stored.slice(0, idx),
    facilityTypeId: stored.slice(idx + 1),
  };
}

export type SelfEvalAnswerInput = { questionId: string; response: boolean };

export type ResolvedSelfEvalAnswer = {
  def: SelfEvalQuestionDef;
  met: boolean;
};

export function resolveSelfEvalAnswerItems(
  facilityTypeId: string,
  items: SelfEvalAnswerInput[],
  options: {
    allowEmpty: boolean;
    standardsVersion?: string;
    assessmentType?: AssessmentCatalogAssessmentType;
  },
): {
  answers: Record<string, boolean>;
  resolvedQuestions: ResolvedSelfEvalAnswer[];
} {
  if (!options.allowEmpty && (!items || items.length === 0)) {
    throw new BadRequestException('At least one self-evaluation answer is required');
  }

  const assessmentType = options.assessmentType ?? 'self_assessment';
  const standardsVersion =
    options.standardsVersion ?? getCurrentCatalogVersion(assessmentType);

  // Unknown identity must fail explicitly (no latest-version fallback).
  resolveAssessmentCatalog({
    assessmentType,
    standardsVersion,
    facilityTypeId,
  });

  const catalogQuestions = getAnswerableQuestions(
    facilityTypeId,
    standardsVersion,
    assessmentType,
  );
  const seenQuestionIds = new Set<string>();
  const answers: Record<string, boolean> = {};
  const resolvedQuestions: ResolvedSelfEvalAnswer[] = [];

  for (const item of items ?? []) {
    if (item.questionId === SELF_EVAL_SCORE_CODE) {
      throw new BadRequestException('questionId SELF-EVAL-SCORE is reserved');
    }
    if (seenQuestionIds.has(item.questionId)) {
      throw new BadRequestException(`Duplicate questionId: ${item.questionId}`);
    }
    seenQuestionIds.add(item.questionId);

    const def = catalogQuestions.get(item.questionId);
    if (!def) {
      throw new BadRequestException(
        `Unknown questionId for facility ${facilityTypeId}: ${item.questionId}`,
      );
    }

    answers[item.questionId] = item.response;
    resolvedQuestions.push({ def, met: item.response });
  }

  return { answers, resolvedQuestions };
}

export function rankFromPercent(percent: number): ComplianceRankBand['id'] {
  if (percent >= 90) return 'green';
  if (percent >= 70) return 'blue';
  if (percent >= 50) return 'yellow';
  return 'red';
}

/**
 * Score answers against an explicitly resolved catalog identity.
 * Does not decide which version is current.
 */
export function scoreSelfEvaluationFromAnswers(
  facilityTypeId: string,
  answers: Record<string, boolean>,
  standardsVersion?: string,
  assessmentType: AssessmentCatalogAssessmentType = 'self_assessment',
): SelfEvalScorePreview | null {
  const version = standardsVersion ?? getCurrentCatalogVersion(assessmentType);
  let checklist: SelfEvalFacilityChecklist;
  try {
    checklist = resolveAssessmentCatalog({
      assessmentType,
      standardsVersion: version,
      facilityTypeId,
    }).checklist;
  } catch {
    return null;
  }

  const sectionScores = checklist.sections.map((section) => scoreSection(section, answers));
  const rawEarned = sectionScores.reduce((sum, section) => sum + section.earned, 0);
  const maxScore = checklist.grandTotalMax ?? checklist.computedMaxScore;
  const earnedScore = Math.min(rawEarned, maxScore);
  const percent = maxScore > 0 ? Math.round((earnedScore / maxScore) * 100) : 0;

  return {
    earnedScore,
    maxScore,
    percent,
    rank: rankFromPercent(percent),
  };
}

/** Test helper — previously cleared the singleton cache. */
export function setSelfEvalCatalogForTests(catalog: SelfEvalChecklistCatalog | null): void {
  resetCatalogRegistryForTests();
  if (catalog) {
    registerCatalogVersionForTests('self_assessment', INTERIM_WEIGHTED_CATALOG_VERSION, catalog);
    registerCatalogVersionForTests(
      'supportive_supervision',
      INTERIM_WEIGHTED_CATALOG_VERSION,
      catalog,
    );
  }
}

export function isLegacyScoreOnlyVersion(standardsVersion: string): boolean {
  const { version } = parseSelfEvalStandardsVersion(standardsVersion);
  return version === LEGACY_SCORE_ONLY_VERSION;
}
