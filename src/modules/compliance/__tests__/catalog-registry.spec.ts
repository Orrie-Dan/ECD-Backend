/**
 * SELF-EVAL-ALIGN-02 catalog registry / isolation tests.
 * Run: npx ts-node src/modules/compliance/__tests__/catalog-registry.spec.ts
 */
import { BadRequestException } from '@nestjs/common';
import {
  getCurrentCatalogVersion,
  INTERIM_WEIGHTED_CATALOG_VERSION,
  registerCatalogVersionForTests,
  resetCatalogRegistryForTests,
  resetCurrentCatalogVersionsForTests,
  resolveAssessmentCatalog,
  scoreSelfEvaluationFromAnswers,
  setCurrentCatalogVersionForTests,
  setSelfEvalCatalogForTests,
  unregisterCatalogVersionForTests,
  type SelfEvalChecklistCatalog,
} from '../self-eval-catalog';
import {
  assertSelfEvaluationToolAvailable,
  getSelfEvaluationToolAvailability,
  resolveSelfEvaluationFacility,
} from '../facility-routing';

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

function tinyCatalog(version: string): SelfEvalChecklistCatalog {
  return {
    ranks: [
      { id: 'green', minPercent: 90, maxPercent: 100, labelRw: 'Icyatsi' },
      { id: 'blue', minPercent: 70, maxPercent: 89, labelRw: 'Ubururu' },
      { id: 'yellow', minPercent: 50, maxPercent: 69, labelRw: 'Umuhondo' },
      { id: 'red', minPercent: 0, maxPercent: 49, labelRw: 'Utukura' },
    ],
    facilityTypes: [
      {
        id: 'daycare',
        title: 'Daycare',
        version,
        grandTotalMax: null,
        computedMaxScore: 3,
        sectionCount: 1,
        itemCount: 1,
        sections: [
          {
            id: 's1',
            title: 'Section',
            subtotalMax: null,
            items: [
              {
                id: 'q_weight_probe',
                number: 1,
                text: 'Weight probe',
                maxScore: 3,
                indicators: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function main() {
  assert('resolve daycare interim catalog', () => {
    const result = resolveAssessmentCatalog({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.2-weighted',
      facilityTypeId: 'daycare',
    });
    if (result.checklist.computedMaxScore !== 230) {
      throw new Error(`expected daycare max 230 got ${result.checklist.computedMaxScore}`);
    }
  });

  assert('resolve ecd_3_5 interim catalog', () => {
    const result = resolveAssessmentCatalog({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.2-weighted',
      facilityTypeId: 'ecd_3_5',
    });
    if (result.checklist.computedMaxScore !== 312) {
      throw new Error(`expected ecd max 312 got ${result.checklist.computedMaxScore}`);
    }
  });

  assert('reject unknown standardsVersion', () => {
    try {
      resolveAssessmentCatalog({
        assessmentType: 'self_assessment',
        standardsVersion: '2099.9-missing',
        facilityTypeId: 'daycare',
      });
      throw new Error('expected BadRequestException');
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
    }
  });

  assert('reject unknown facility/version combo', () => {
    try {
      resolveAssessmentCatalog({
        assessmentType: 'self_assessment',
        standardsVersion: '2024.2-weighted',
        facilityTypeId: 'home_based',
      });
      throw new Error('expected BadRequestException');
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
    }
  });

  assert('inspection isolation when self_assessment current changes', () => {
    registerCatalogVersionForTests(
      'self_assessment',
      '2024.3-fixture',
      tinyCatalog('2024.3-fixture'),
    );
    setCurrentCatalogVersionForTests('self_assessment', '2024.3-fixture');

    if (getCurrentCatalogVersion('self_assessment') !== '2024.3-fixture') {
      throw new Error('self_assessment current not overridden');
    }
    if (getCurrentCatalogVersion('supportive_supervision') !== INTERIM_WEIGHTED_CATALOG_VERSION) {
      throw new Error('supportive_supervision current changed unexpectedly');
    }

    const inspection = resolveAssessmentCatalog({
      assessmentType: 'supportive_supervision',
      standardsVersion: getCurrentCatalogVersion('supportive_supervision'),
      facilityTypeId: 'daycare',
    });
    if (inspection.checklist.version !== INTERIM_WEIGHTED_CATALOG_VERSION) {
      throw new Error('inspection catalog not pinned');
    }
    if (inspection.checklist.computedMaxScore !== 230) {
      throw new Error('inspection max changed');
    }

    const inspectionScore = scoreSelfEvaluationFromAnswers(
      'daycare',
      { dc_s711_pregnant_anc_access: true },
      getCurrentCatalogVersion('supportive_supervision'),
      'supportive_supervision',
    );
    if (!inspectionScore || inspectionScore.maxScore !== 230) {
      throw new Error('inspection scoring not using pinned catalog');
    }

    unregisterCatalogVersionForTests('self_assessment', '2024.3-fixture');
    resetCurrentCatalogVersionsForTests();
  });

  assert('draft version A remains resolvable after current becomes B', () => {
    registerCatalogVersionForTests(
      'self_assessment',
      '2024.3-fixture',
      tinyCatalog('2024.3-fixture'),
    );
    setCurrentCatalogVersionForTests('self_assessment', '2024.3-fixture');

    const pinned = resolveAssessmentCatalog({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.2-weighted',
      facilityTypeId: 'daycare',
    });
    if (pinned.checklist.version !== '2024.2-weighted') {
      throw new Error('draft pin broken');
    }

    unregisterCatalogVersionForTests('self_assessment', '2024.3-fixture');
    resetCurrentCatalogVersionsForTests();
  });

  assert('historical score uses snapshotted weight semantics (fixture)', () => {
    // Simulate: submit under weight=1 catalog, then catalog becomes weight=3.
    const weight1: SelfEvalChecklistCatalog = {
      ranks: tinyCatalog('snap-v1').ranks,
      facilityTypes: [
        {
          ...tinyCatalog('snap-v1').facilityTypes[0],
          version: 'snap-v1',
          computedMaxScore: 1,
          sections: [
            {
              id: 's1',
              title: 'Section',
              subtotalMax: null,
              items: [
                {
                  id: 'q_weight_probe',
                  number: 1,
                  text: 'Weight probe',
                  maxScore: 1,
                  indicators: [],
                },
              ],
            },
          ],
        },
      ],
    };
    registerCatalogVersionForTests('self_assessment', 'snap-v1', weight1);
    const historical = scoreSelfEvaluationFromAnswers(
      'daycare',
      { q_weight_probe: true },
      'snap-v1',
      'self_assessment',
    );
    if (!historical || historical.earnedScore !== 1 || historical.maxScore !== 1) {
      throw new Error(`expected historical earned/max 1 got ${JSON.stringify(historical)}`);
    }

    registerCatalogVersionForTests('self_assessment', 'snap-v2', tinyCatalog('snap-v2'));
    const current = scoreSelfEvaluationFromAnswers(
      'daycare',
      { q_weight_probe: true },
      'snap-v2',
      'self_assessment',
    );
    if (!current || current.earnedScore !== 3) {
      throw new Error('current catalog weight fixture broken');
    }

    // Re-resolve historical identity — must still be weight 1.
    const stillHistorical = scoreSelfEvaluationFromAnswers(
      'daycare',
      { q_weight_probe: true },
      'snap-v1',
      'self_assessment',
    );
    if (!stillHistorical || stillHistorical.earnedScore !== 1) {
      throw new Error('historical score mutated after catalog change');
    }

    unregisterCatalogVersionForTests('self_assessment', 'snap-v1');
    unregisterCatalogVersionForTests('self_assessment', 'snap-v2');
  });

  assert('ALIGN-03 resolves 2024.3-official under self_assessment for all four facilities', () => {
    const expected: Record<string, { sections: number; items: number; computed: number }> = {
      daycare: { sections: 16, items: 130, computed: 195 },
      home_based: { sections: 8, items: 50, computed: 66 },
      community_based: { sections: 15, items: 119, computed: 161 },
      ecd_3_5: { sections: 22, items: 172, computed: 251 },
    };
    for (const [facilityTypeId, exp] of Object.entries(expected)) {
      const result = resolveAssessmentCatalog({
        assessmentType: 'self_assessment',
        standardsVersion: '2024.3-official',
        facilityTypeId,
      });
      if (result.checklist.sectionCount !== exp.sections) {
        throw new Error(`${facilityTypeId} sections ${result.checklist.sectionCount} != ${exp.sections}`);
      }
      if (result.checklist.itemCount !== exp.items) {
        throw new Error(`${facilityTypeId} items ${result.checklist.itemCount} != ${exp.items}`);
      }
      if (result.checklist.computedMaxScore !== exp.computed) {
        throw new Error(
          `${facilityTypeId} computed ${result.checklist.computedMaxScore} != ${exp.computed}`,
        );
      }
    }
  });

  assert('ALIGN-03 does not register supportive_supervision + 2024.3-official', () => {
    try {
      resolveAssessmentCatalog({
        assessmentType: 'supportive_supervision',
        standardsVersion: '2024.3-official',
        facilityTypeId: 'daycare',
      });
      throw new Error('expected BadRequestException');
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
    }
  });

  assert('ALIGN-03 keeps supportive_supervision on 2024.2-weighted after activation', () => {
    if (getCurrentCatalogVersion('self_assessment') !== '2024.3-official') {
      throw new Error('self_assessment current not activated to 2024.3-official');
    }
    if (getCurrentCatalogVersion('supportive_supervision') !== INTERIM_WEIGHTED_CATALOG_VERSION) {
      throw new Error('supportive_supervision current changed');
    }
  });

  assert('ALIGN-05C home_based official is available for draft/submit', () => {
    const home = getSelfEvaluationToolAvailability({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      facilityTypeId: 'home_based',
    });
    if (!home.available) {
      throw new Error(`home_based should be available, got ${home.reason}`);
    }
    assertSelfEvaluationToolAvailable({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      facilityTypeId: 'home_based',
    });
    const daycare = getSelfEvaluationToolAvailability({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      facilityTypeId: 'daycare',
    });
    if (!daycare.available) {
      throw new Error('daycare should be available');
    }
    expectFacilityResolve();
  });

  assert('ALIGN-04 new self-assessment current resolves official daycare max 195', () => {
    const result = resolveAssessmentCatalog({
      assessmentType: 'self_assessment',
      standardsVersion: getCurrentCatalogVersion('self_assessment'),
      facilityTypeId: 'daycare',
    });
    if (result.checklist.version !== '2024.3-official') {
      throw new Error(`expected official got ${result.checklist.version}`);
    }
    if (result.checklist.computedMaxScore !== 195) {
      throw new Error(`expected max 195 got ${result.checklist.computedMaxScore}`);
    }
  });

  assert('ALIGN-03 official all-Yes / all-No scoring smoke (daycare)', () => {
    const { checklist } = resolveAssessmentCatalog({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      facilityTypeId: 'daycare',
    });
    const allYes: Record<string, boolean> = {};
    for (const section of checklist.sections) {
      for (const item of section.items) {
        if (item.indicators.length > 0) {
          for (const ind of item.indicators) allYes[ind.id] = true;
        } else {
          allYes[item.id] = true;
        }
      }
    }
    const yesScore = scoreSelfEvaluationFromAnswers(
      'daycare',
      allYes,
      '2024.3-official',
      'self_assessment',
    );
    if (!yesScore || yesScore.earnedScore !== checklist.computedMaxScore) {
      throw new Error(`all-Yes earned ${yesScore?.earnedScore} != ${checklist.computedMaxScore}`);
    }
    const noScore = scoreSelfEvaluationFromAnswers(
      'daycare',
      {},
      '2024.3-official',
      'self_assessment',
    );
    if (!noScore || noScore.earnedScore !== 0) {
      throw new Error(`all-No earned ${noScore?.earnedScore}`);
    }
  });

  assert('ALIGN-05C home_based all-Yes is 66/66 with Section 6 ceiling', () => {
    const { checklist } = resolveAssessmentCatalog({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      facilityTypeId: 'home_based',
    });
    if (checklist.computedMaxScore !== 66 || checklist.grandTotalMax !== 66) {
      throw new Error(
        `expected home_based max 66 got computed=${checklist.computedMaxScore} declared=${checklist.grandTotalMax}`,
      );
    }
    const s06 = checklist.sections.find((s) => s.id.endsWith('-S06'));
    if (!s06 || s06.subtotalMax !== 10 || s06.items.length !== 9) {
      throw new Error('Section 6 structure unexpected');
    }
    const s08 = checklist.sections.find((s) => s.id.endsWith('-S08'));
    if (!s08 || s08.items.length !== 2 || s08.items[0].indicators.length !== 3) {
      throw new Error('Section 8 OR structure unexpected');
    }
    const allYes: Record<string, boolean> = {};
    for (const section of checklist.sections) {
      for (const item of section.items) {
        if (item.indicators.length > 0) {
          for (const ind of item.indicators) allYes[ind.id] = true;
        } else {
          allYes[item.id] = true;
        }
      }
    }
    const yesScore = scoreSelfEvaluationFromAnswers(
      'home_based',
      allYes,
      '2024.3-official',
      'self_assessment',
    );
    if (!yesScore || yesScore.earnedScore !== 66 || yesScore.maxScore !== 66 || yesScore.percent !== 100) {
      throw new Error(`home_based all-Yes unexpected ${JSON.stringify(yesScore)}`);
    }
    if (yesScore.rank !== 'green') {
      throw new Error(`expected green got ${yesScore.rank}`);
    }
  });

  resetCatalogRegistryForTests();
  setSelfEvalCatalogForTests(null);
  resetCurrentCatalogVersionsForTests();
  console.log('All catalog-registry tests passed.');
}

function expectFacilityResolve() {
  const resolved = resolveSelfEvaluationFacility({
    explicitFacilityTypeId: 'community_based',
  });
  if (resolved.facilityTypeId !== 'community_based') {
    throw new Error('facility resolve failed');
  }
  try {
    resolveSelfEvaluationFacility({});
    throw new Error('expected unresolved facility');
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
