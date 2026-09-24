import { readFileSync } from 'fs';
import { join } from 'path';
import type { SelfEvalChecklistCatalog } from './self-eval-catalog';
import {
  INTERIM_WEIGHTED_CATALOG_VERSION,
  OFFICIAL_CATALOG_VERSION,
  type AssessmentCatalogAssessmentType,
} from './catalog-versions';

/**
 * Versioned catalog registry.
 *
 * Conceptual layout:
 *   assessmentType → standardsVersion → facilityTypeId → checklist
 *
 * - 2024.2-weighted: data/checklists.generated.json (both assessment types)
 * - 2024.3-official: data/2024.3-official/catalog.json (self_assessment only)
 */

type RegistryKey = `${AssessmentCatalogAssessmentType}::${string}`;

const catalogs = new Map<RegistryKey, SelfEvalChecklistCatalog>();

function key(assessmentType: AssessmentCatalogAssessmentType, version: string): RegistryKey {
  return `${assessmentType}::${version}`;
}

function loadJsonCatalog(relativeParts: string[]): SelfEvalChecklistCatalog {
  const raw = readFileSync(join(__dirname, ...relativeParts), 'utf8');
  return JSON.parse(raw) as SelfEvalChecklistCatalog;
}

let productionLoaded = false;

function ensureProductionRegistrations(): void {
  if (productionLoaded) return;
  const interim = loadJsonCatalog(['data', 'checklists.generated.json']);
  const official = loadJsonCatalog(['data', '2024.3-official', 'catalog.json']);
  catalogs.set(key('self_assessment', INTERIM_WEIGHTED_CATALOG_VERSION), interim);
  catalogs.set(key('supportive_supervision', INTERIM_WEIGHTED_CATALOG_VERSION), interim);
  catalogs.set(key('self_assessment', OFFICIAL_CATALOG_VERSION), official);
  productionLoaded = true;
}

export function getRegisteredCatalog(
  assessmentType: AssessmentCatalogAssessmentType,
  standardsVersion: string,
): SelfEvalChecklistCatalog | null {
  ensureProductionRegistrations();
  return catalogs.get(key(assessmentType, standardsVersion)) ?? null;
}

export function listRegisteredCatalogKeys(): Array<{
  assessmentType: AssessmentCatalogAssessmentType;
  standardsVersion: string;
  facilityTypeIds: string[];
}> {
  ensureProductionRegistrations();
  const out: Array<{
    assessmentType: AssessmentCatalogAssessmentType;
    standardsVersion: string;
    facilityTypeIds: string[];
  }> = [];
  for (const [k, catalog] of catalogs.entries()) {
    const [assessmentType, standardsVersion] = k.split('::') as [
      AssessmentCatalogAssessmentType,
      string,
    ];
    out.push({
      assessmentType,
      standardsVersion,
      facilityTypeIds: catalog.facilityTypes.map((f) => f.id),
    });
  }
  return out.sort((a, b) =>
    `${a.assessmentType}/${a.standardsVersion}`.localeCompare(
      `${b.assessmentType}/${b.standardsVersion}`,
    ),
  );
}

/** Test helper — inject a catalog version without touching the generated JSON. */
export function registerCatalogVersionForTests(
  assessmentType: AssessmentCatalogAssessmentType,
  standardsVersion: string,
  catalog: SelfEvalChecklistCatalog,
): void {
  ensureProductionRegistrations();
  catalogs.set(key(assessmentType, standardsVersion), catalog);
}

export function unregisterCatalogVersionForTests(
  assessmentType: AssessmentCatalogAssessmentType,
  standardsVersion: string,
): void {
  if (
    standardsVersion === INTERIM_WEIGHTED_CATALOG_VERSION ||
    standardsVersion === OFFICIAL_CATALOG_VERSION
  ) {
    throw new Error(`Cannot unregister production catalog ${standardsVersion}`);
  }
  catalogs.delete(key(assessmentType, standardsVersion));
}

/** Clears cache so the next resolve reloads production JSON (tests). */
export function resetCatalogRegistryForTests(): void {
  catalogs.clear();
  productionLoaded = false;
}
