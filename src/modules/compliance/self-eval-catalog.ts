import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Self-evaluation question identity
 * ---------------------------------
 * Frontend checklist IDs (checklists.generated.json) are the stable keys:
 *   daycare  → dc_*
 *   ecd_3_5  → ecd_*
 *
 * Mapping: questionId === EcdStandard.code
 *
 * Standards are ensured (find-or-create by unique `code`) on submit so we never
 * insert a duplicate catalog row per assessment. Historical answers stay
 * interpretable from `compliance_assessment_item.standard_id` → `ecd_standard.code`
 * even if frontend JSON later changes, as long as codes are not reused.
 */

export const SELF_EVAL_SCORE_CODE = 'SELF-EVAL-SCORE';

export type SelfEvalSelectionMode = 'all' | 'any';

export interface SelfEvalIndicator {
  id: string;
  label: string;
  maxScore: number;
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
  version: string;
}

export interface SelfEvalScorePreview {
  earnedScore: number;
  maxScore: number;
  percent: number;
  rank: ComplianceRankBand['id'];
}

let cachedCatalog: SelfEvalChecklistCatalog | null = null;

function loadCatalog(): SelfEvalChecklistCatalog {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  const raw = readFileSync(join(__dirname, 'data', 'checklists.generated.json'), 'utf8');
  cachedCatalog = JSON.parse(raw) as SelfEvalChecklistCatalog;
  return cachedCatalog;
}

/** Test helper — inject a catalog without touching the generated JSON. */
export function setSelfEvalCatalogForTests(catalog: SelfEvalChecklistCatalog | null): void {
  cachedCatalog = catalog;
}

export function getSelfEvalCatalog(): SelfEvalChecklistCatalog {
  return loadCatalog();
}

export function getFacilityChecklist(facilityTypeId: string): SelfEvalFacilityChecklist | null {
  return getSelfEvalCatalog().facilityTypes.find((f) => f.id === facilityTypeId) ?? null;
}

/**
 * Answerable IDs for a facility: simple items use item.id; multi-indicator
 * items use each indicator.id (matching frontend SelfEvalItemAnswers keys).
 */
export function getAnswerableQuestions(facilityTypeId: string): Map<string, SelfEvalQuestionDef> {
  const checklist = getFacilityChecklist(facilityTypeId);
  const map = new Map<string, SelfEvalQuestionDef>();
  if (!checklist) {
    return map;
  }

  for (const section of checklist.sections) {
    for (const item of section.items) {
      if (item.indicators.length > 0) {
        for (const indicator of item.indicators) {
          map.set(indicator.id, {
            questionId: indicator.id,
            title: indicator.label || item.text,
            maxScore: indicator.maxScore,
            facilityTypeId: checklist.id,
            sectionId: section.id,
            version: checklist.version,
          });
        }
      } else {
        map.set(item.id, {
          questionId: item.id,
          title: item.text,
          maxScore: item.maxScore,
          facilityTypeId: checklist.id,
          sectionId: section.id,
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
  options: { allowEmpty: boolean },
): {
  answers: Record<string, boolean>;
  resolvedQuestions: ResolvedSelfEvalAnswer[];
} {
  if (!options.allowEmpty && (!items || items.length === 0)) {
    throw new BadRequestException('At least one self-evaluation answer is required');
  }

  const catalogQuestions = getAnswerableQuestions(facilityTypeId);
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

export function scoreSelfEvaluationFromAnswers(
  facilityTypeId: string,
  answers: Record<string, boolean>,
): SelfEvalScorePreview | null {
  const checklist = getFacilityChecklist(facilityTypeId);
  if (!checklist) {
    return null;
  }

  const earnedScore = checklist.sections.reduce(
    (sum, section) =>
      sum + section.items.reduce((itemSum, item) => itemSum + scoreItem(item, answers), 0),
    0,
  );
  const maxScore = checklist.grandTotalMax ?? checklist.computedMaxScore;
  const percent = maxScore > 0 ? Math.round((earnedScore / maxScore) * 100) : 0;

  return {
    earnedScore,
    maxScore,
    percent,
    rank: rankFromPercent(percent),
  };
}
