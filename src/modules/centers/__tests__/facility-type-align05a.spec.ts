/**
 * SELF-EVAL-ALIGN-05A — facility type mapping + center routing authority.
 * Run: npx ts-node src/modules/centers/__tests__/facility-type-align05a.spec.ts
 */
import { BadRequestException } from '@nestjs/common';
import {
  mapSettingsTypesToFacilityType,
  SETTINGS_TYPES_TO_FACILITY_TYPE,
} from '../facility-type-mapping';
import {
  assertCenterFacilityMatchesSelfEval,
  resolveSelfEvaluationFacility,
} from '../../compliance/facility-routing';
import { getCurrentCatalogVersion } from '../../compliance/catalog-versions';
import { parseSelfEvalStandardsVersion } from '../../compliance/self-eval-catalog';

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

function eq(actual: unknown, expected: unknown, label?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label ?? 'eq'} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

assert('mapping: every deterministic settings_types value', () => {
  for (const [source, canonical] of Object.entries(SETTINGS_TYPES_TO_FACILITY_TYPE)) {
    const result = mapSettingsTypesToFacilityType(source);
    eq(result.mapped, true);
    eq(result.facilityType, canonical);
  }
});

assert('mapping: unknown never falls back to daycare', () => {
  for (const value of [
    'Centre Based',
    'Faith-based',
    'Market based',
    'Mobile crèches',
    'ECD in emergency settings',
    'Daycare',
  ]) {
    const result = mapSettingsTypesToFacilityType(value);
    eq(result.facilityType, null);
    if (result.mapped) throw new Error('expected unmapped');
    eq(result.reason, 'unmapped');
  }
});

assert('routing: center daycare rejects community_based request for official', () => {
  try {
    assertCenterFacilityMatchesSelfEval({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      centerFacilityType: 'daycare',
      requestFacilityTypeId: 'community_based',
    });
    throw new Error('expected BadRequestException');
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
  }
});

assert('routing: center community_based rejects daycare request', () => {
  try {
    assertCenterFacilityMatchesSelfEval({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      centerFacilityType: 'community_based',
      requestFacilityTypeId: 'daycare',
    });
    throw new Error('expected BadRequestException');
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
  }
});

assert('routing: center ecd_3_5 accepts matching request', () => {
  const id = assertCenterFacilityMatchesSelfEval({
    assessmentType: 'self_assessment',
    standardsVersion: '2024.3-official',
    centerFacilityType: 'ecd_3_5',
    requestFacilityTypeId: 'ecd_3_5',
  });
  eq(id, 'ecd_3_5');
});

assert('routing: null center type blocks official new draft', () => {
  try {
    assertCenterFacilityMatchesSelfEval({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      centerFacilityType: null,
      requestFacilityTypeId: 'daycare',
    });
    throw new Error('expected BadRequestException');
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
  }
});

assert('routing: legacy 2024.2 draft resumes despite center type', () => {
  const id = assertCenterFacilityMatchesSelfEval({
    assessmentType: 'self_assessment',
    standardsVersion: '2024.2-weighted',
    centerFacilityType: 'community_based',
    requestFacilityTypeId: 'daycare',
    legacyPinnedDraft: true,
  });
  eq(id, 'daycare');
});

assert('historical safety: assessment identity independent of center reclassify', () => {
  const encoded = '2024.3-official/daycare';
  const parsed = parseSelfEvalStandardsVersion(encoded);
  eq(parsed.facilityTypeId, 'daycare');
  // Center later becomes community_based — historical parse unchanged.
  eq(parsed.version, '2024.3-official');
});

assert('home_based center resolves home_based', () => {
  const resolved = resolveSelfEvaluationFacility({ centerFacilityType: 'home_based' });
  eq(resolved.facilityTypeId, 'home_based');
  eq(resolved.source, 'center');
});

assert('supportive_supervision current unchanged by ALIGN-05A', () => {
  eq(getCurrentCatalogVersion('supportive_supervision'), '2024.2-weighted');
});

console.log('All ALIGN-05A facility-type tests passed.');
