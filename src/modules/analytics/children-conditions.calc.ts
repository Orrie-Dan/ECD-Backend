/**
 * Children-by-condition per admin area — pure aggregation, no Prisma, unit-testable.
 * Inputs are already scoped; outputs carry per-area totals only (no child rows).
 */
import { STUNTING_MIN_SCREENED, roundPercent } from '../gis/center-metrics/center-metrics.calc';
import {
  classifyHeightForAge,
  classifyMuacForAge,
  classifyWeightForAge,
} from '../nutrition/who/classify';
import { toDateOnlyString } from '../nutrition/who/concern';
import { isWhoConcernZone, isWhoZoneResult, type WhoClassification } from '../nutrition/who/types';
import type {
  ChildrenConditionAreaDto,
  ChildrenConditionMeasureDto,
} from './dto/children-conditions-response.dto';

/**
 * Below this denominator an area's affected count and rate are withheld — same
 * small-n rule as the center metrics map, so the two never disagree.
 */
export const CONDITION_MIN_DENOMINATOR = STUNTING_MIN_SCREENED;

export type ConditionArea = {
  areaId: string;
  areaName: string;
  areaCode: string;
  districtId: string;
  districtName: string;
};

export type AreaChildrenRow = { areaId: string; active: number; withDisability: number };

type ChildRef = {
  areaId: string;
  childId: string;
  dateOfBirth: Date | string | null;
  gender: string | null;
  screeningDate: Date | string | null;
};

/** One row per child: their latest screening in range (weight and MUAC are always recorded). */
export type LatestScreeningRow = ChildRef & { weightKg: number | null; muacCm: number | null };

/** One row per child: their latest screening in range that has a height. */
export type LatestHeightRow = ChildRef & { heightCm: number | null };

type Count = { classified: number; affected: number };

export type AreaConditionTally = {
  screened: number;
  stunting: Count;
  underweight: Count;
  lowMuac: Count;
  anyMalnutrition: Count;
};

const emptyCount = (): Count => ({ classified: 0, affected: 0 });

function emptyTally(): AreaConditionTally {
  return {
    screened: 0,
    stunting: emptyCount(),
    underweight: emptyCount(),
    lowMuac: emptyCount(),
    anyMalnutrition: emptyCount(),
  };
}

function classifyInput(row: ChildRef) {
  return {
    dateOfBirth: toDateOnlyString(row.dateOfBirth),
    gender: row.gender,
    screeningDate: toDateOnlyString(row.screeningDate),
  };
}

/** `null` = not classifiable (excluded from the denominator); otherwise whether < −2 SD. */
function concern(result: WhoClassification): boolean | null {
  return isWhoZoneResult(result) ? isWhoConcernZone(result.zone) : null;
}

function bump(count: Count, hit: boolean | null) {
  if (hit == null) return;
  count.classified += 1;
  if (hit) count.affected += 1;
}

/**
 * Per-area WHO tallies. Stunting uses each child's latest height in range (as the
 * center map does); underweight and low MUAC use their latest screening. A child
 * counts toward "any malnutrition" when at least one indicator is classifiable,
 * and as affected when any classifiable indicator is below −2 SD.
 */
export function tallyConditionsByArea(
  screenings: LatestScreeningRow[],
  heights: LatestHeightRow[],
): Map<string, AreaConditionTally> {
  const tallies = new Map<string, AreaConditionTally>();
  const tallyFor = (areaId: string) => {
    let tally = tallies.get(areaId);
    if (!tally) {
      tally = emptyTally();
      tallies.set(areaId, tally);
    }
    return tally;
  };

  // childId → [areaId, any-indicator hit]
  const perChild = new Map<string, { areaId: string; hits: Array<boolean | null> }>();
  const hitsFor = (row: ChildRef) => {
    let entry = perChild.get(row.childId);
    if (!entry) {
      entry = { areaId: row.areaId, hits: [] };
      perChild.set(row.childId, entry);
    }
    return entry.hits;
  };

  for (const row of screenings) {
    const tally = tallyFor(row.areaId);
    tally.screened += 1;
    const base = classifyInput(row);
    const underweight = concern(classifyWeightForAge({ ...base, weightKg: row.weightKg }));
    const lowMuac = concern(classifyMuacForAge({ ...base, muacCm: row.muacCm }));
    bump(tally.underweight, underweight);
    bump(tally.lowMuac, lowMuac);
    hitsFor(row).push(underweight, lowMuac);
  }

  for (const row of heights) {
    const stunted = concern(
      classifyHeightForAge({ ...classifyInput(row), heightCm: row.heightCm }),
    );
    bump(tallyFor(row.areaId).stunting, stunted);
    hitsFor(row).push(stunted);
  }

  for (const { areaId, hits } of perChild.values()) {
    const classified = hits.filter((h): h is boolean => h != null);
    if (classified.length === 0) continue;
    bump(tallyFor(areaId).anyMalnutrition, classified.some(Boolean));
  }

  return tallies;
}

/** Affected count + rate, withheld (null) when the denominator is below the minimum. */
export function conditionMeasure(
  affected: number,
  denominator: number,
  minDenominator = CONDITION_MIN_DENOMINATOR,
): ChildrenConditionMeasureDto {
  if (denominator < minDenominator) return { denominator, affected: null, rate: null };
  return { denominator, affected, rate: roundPercent(affected, denominator) };
}

/** One row per area (areas with no children included, all-zero), ordered by name. */
export function buildConditionAreaItems(
  areas: ConditionArea[],
  children: AreaChildrenRow[],
  tallies: Map<string, AreaConditionTally>,
): ChildrenConditionAreaDto[] {
  const childrenByArea = new Map(children.map((row) => [row.areaId, row]));
  return [...areas]
    .sort((a, b) => a.areaName.localeCompare(b.areaName))
    .map((area) => {
      const kids = childrenByArea.get(area.areaId);
      const active = kids?.active ?? 0;
      const tally = tallies.get(area.areaId) ?? emptyTally();
      const notScreened = Math.max(0, active - tally.screened);
      return {
        ...area,
        activeChildren: active,
        stunting: conditionMeasure(tally.stunting.affected, tally.stunting.classified),
        underweight: conditionMeasure(tally.underweight.affected, tally.underweight.classified),
        lowMuac: conditionMeasure(tally.lowMuac.affected, tally.lowMuac.classified),
        anyMalnutrition: conditionMeasure(
          tally.anyMalnutrition.affected,
          tally.anyMalnutrition.classified,
        ),
        disability: conditionMeasure(kids?.withDisability ?? 0, active),
        notScreened: conditionMeasure(notScreened, active),
      };
    });
}
