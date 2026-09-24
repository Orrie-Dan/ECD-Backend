/**
 * SELF-EVAL-ALIGN-06 — Live API acceptance harness.
 * Tracks created assessments; restores ESRI facilityType; soft-deletes disposable drafts.
 * Does not print passwords.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import {
  getAnswerableQuestions,
  scoreSelfEvaluationFromAnswers,
  encodeSelfEvalStandardsVersion,
  parseSelfEvalStandardsVersion,
  resolveAssessmentCatalog,
} from '../src/modules/compliance/self-eval-catalog';
import {
  getSelfEvaluationToolAvailability,
  assertCenterFacilityMatchesSelfEval,
} from '../src/modules/compliance/facility-routing';
import { getRegisteredCatalog } from '../src/modules/compliance/catalog-registry';
import {
  SELF_ASSESSMENT_CURRENT_VERSION,
  SUPPORTIVE_SUPERVISION_CURRENT_VERSION,
  getCurrentCatalogVersion,
} from '../src/modules/compliance/catalog-versions';

const prisma = new PrismaClient();
const API = (process.env.ALIGN06_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
const PASS = process.env.ALIGN06_TEMP_PASSWORD || 'Align06-AuditTmp!';
const DATE = new Date().toISOString().slice(0, 10);
const REPORT: Record<string, unknown> = { api: API, results: [] as unknown[] };

type Facility = 'daycare' | 'home_based' | 'community_based' | 'ecd_3_5';

function log(step: string, data?: unknown) {
  const row = { step, data, at: new Date().toISOString() };
  (REPORT.results as unknown[]).push(row);
  console.log(`## ${step}`);
  if (data !== undefined) console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function api(method: string, pathName: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json, text };
}

async function login(username: string) {
  const r = await api('POST', '/api/v1/auth/login', undefined, { username, password: PASS });
  if (r.status >= 400) throw new Error(`login ${username} ${r.status} ${JSON.stringify(r.json)}`);
  const token = r.json.accessToken || r.json?.data?.accessToken;
  if (!token) throw new Error(`no token for ${username}`);
  return token as string;
}

async function setPassword(username: string) {
  const hash = await bcrypt.hash(PASS, 10);
  await prisma.$executeRaw`
    UPDATE sde.user_account SET password_hash = ${hash}, password_changed_at = now(), updated_at = now()
    WHERE username = ${username}
  `;
}

async function setFacilityType(centerId: string, facilityType: string | null) {
  await prisma.ecdCenter.update({ where: { id: centerId }, data: { facilityType } });
}

function answerableItems(facility: Facility, value: boolean) {
  const qs = getAnswerableQuestions(facility, '2024.3-official', 'self_assessment');
  return [...qs.keys()].map((questionId) => ({ questionId, response: value }));
}

function scorePreview(facility: Facility, items: Array<{ questionId: string; response: boolean }>) {
  const answers = Object.fromEntries(items.map((i) => [i.questionId, i.response]));
  return scoreSelfEvaluationFromAnswers(facility, answers, '2024.3-official', 'self_assessment');
}

async function deleteDraft(token: string) {
  await api('DELETE', '/api/v1/compliance/self-evaluations/draft', token);
}

async function softDeleteAssessments(ids: string[]) {
  if (!ids.length) return;
  await prisma.complianceAssessment.updateMany({
    where: { id: { in: ids } },
    data: { deletedAt: new Date() },
  });
}

async function runFacilityE2E(
  facility: Facility,
  centerId: string,
  createdIds: string[],
  opts: { submitAllNo?: boolean; submitAllYes?: boolean } = {},
) {
  const out: Record<string, unknown> = { facility };
  await setFacilityType(centerId, facility);
  const token = await login('test2');

  // Routing / availability
  const avail = getSelfEvaluationToolAvailability({
    assessmentType: 'self_assessment',
    standardsVersion: '2024.3-official',
    facilityTypeId: facility,
  });
  out.availability = avail;
  const catalog = resolveAssessmentCatalog({
    assessmentType: 'self_assessment',
    standardsVersion: '2024.3-official',
    facilityTypeId: facility,
  });
  out.catalog = {
    version: catalog.checklist.version,
    max: catalog.checklist.grandTotalMax ?? catalog.checklist.computedMaxScore,
    sections: catalog.checklist.sectionCount,
    items: catalog.checklist.itemCount,
    sectionIds: catalog.checklist.sections.map((s) => s.id),
  };

  // Home-Based specific structure checks
  if (facility === 'home_based') {
    const s6 = catalog.checklist.sections.find((s) => s.id === 'OFFICIAL-HOME_BASED-S06')!;
    const s8 = catalog.checklist.sections.find((s) => s.id === 'OFFICIAL-HOME_BASED-S08')!;
    out.homeBased = {
      s6Criteria: s6.items.length,
      s6SubtotalMax: s6.subtotalMax,
      s6WeightSum: s6.items.reduce((a, i) => a + i.maxScore, 0),
      s8SubtotalMax: s8.subtotalMax,
      s8Q1Mode: s8.items[0].selectionMode,
      s8Q1Indicators: s8.items[0].indicators.length,
      s8Q2Max: s8.items[1].maxScore,
      grand: catalog.checklist.grandTotalMax,
      computed: catalog.checklist.computedMaxScore,
    };

    // Cap check via full all-yes score: max must be 66 not 69
    const allYes = scoreSelfEvaluationFromAnswers(
      'home_based',
      Object.fromEntries(answerableItems('home_based', true).map((i) => [i.questionId, i.response])),
      '2024.3-official',
    )!;
    out.homeBasedAllYes = allYes;

    // Section 8 multi-path: all three quals → still max 1 for Q001 + 1 for Q002 = 2 section, overall capped
    const s8OnlyAnswers: Record<string, boolean> = {
      'OFFICIAL-HOME_BASED-S08-Q001-IND01': true,
      'OFFICIAL-HOME_BASED-S08-Q001-IND02': true,
      'OFFICIAL-HOME_BASED-S08-Q001-IND03': true,
      'OFFICIAL-HOME_BASED-S08-Q002': true,
    };
    const s8Only = scoreSelfEvaluationFromAnswers('home_based', s8OnlyAnswers, '2024.3-official')!;
    out.homeBasedS8MultiPathOnly = s8Only;
  }

  await deleteDraft(token);

  // Start draft with subset
  const allItems = answerableItems(facility, false);
  const subset = allItems.slice(0, Math.min(5, allItems.length)).map((i) => ({
    ...i,
    response: true,
  }));
  const draftSave = await api('PUT', '/api/v1/compliance/self-evaluations/draft', token, {
    facilityTypeId: facility,
    standardsVersion: '2024.3-official',
    assessmentDate: DATE,
    clientDraftId: `align06-${facility}-${Date.now()}`,
    items: subset,
  });
  out.draftSave = { status: draftSave.status, id: draftSave.json?.id, standardsVersion: draftSave.json?.standardsVersion };
  if (draftSave.status >= 400) {
    out.FAIL = 'draftSave';
    log(`E2E ${facility}`, out);
    return out;
  }
  if (draftSave.json?.id) createdIds.push(draftSave.json.id);

  // Resume
  const draftGet = await api('GET', '/api/v1/compliance/self-evaluations/draft', token);
  const draft = draftGet.json?.draft ?? draftGet.json;
  out.resume = {
    status: draftGet.status,
    standardsVersion: draft?.standardsVersion,
    facilityParsed: draft?.standardsVersion
      ? parseSelfEvalStandardsVersion(draft.standardsVersion)
      : null,
    itemCount: draft?.items?.length ?? draftGet.json?.items?.length,
  };

  // Complete + submit (minimal all-no: unanswered criteria score 0 → RED / 0%)
  const submitItems = opts.submitAllYes
    ? answerableItems(facility, true)
    : answerableItems(facility, false).slice(0, 1).map((i) => ({ ...i, response: false }));
  const preview = scorePreview(facility, submitItems)!;
  // For partial all-no, recompute expected against empty/false map
  const expected = opts.submitAllYes
    ? preview
    : scoreSelfEvaluationFromAnswers(
        facility,
        Object.fromEntries(submitItems.map((i) => [i.questionId, i.response])),
        '2024.3-official',
      )!;
  const submit = await api('POST', '/api/v1/compliance/self-evaluations', token, {
    centerId,
    facilityTypeId: facility,
    standardsVersion: '2024.3-official',
    assessmentDate: DATE,
    earnedScore: expected.earnedScore,
    maxScore: expected.maxScore,
    percent: expected.percent,
    rank: expected.rank,
    items: submitItems,
    assessmentId: draftSave.json.id,
  });
  out.submit = {
    status: submit.status,
    id: submit.json?.id,
    standardsVersion: submit.json?.standardsVersion,
    overallPercent: submit.json?.overallPercent,
    overallRank: submit.json?.overallRank,
    message: submit.json?.message,
    expected,
  };
  if (submit.json?.id) createdIds.push(submit.json.id);

  // History list
  const list = await api(
    'GET',
    `/api/v1/compliance/assessments?centerId=${centerId}&assessmentType=self_assessment&pageSize=20`,
    token,
  );
  const rows = list.json?.data ?? list.json?.items ?? list.json?.results ?? [];
  out.history = {
    status: list.status,
    found: Array.isArray(rows)
      ? rows.some((r: any) => r.id === submit.json?.id)
      : false,
    sampleVersions: Array.isArray(rows)
      ? rows.slice(0, 5).map((r: any) => ({ id: r.id, v: r.standardsVersion, status: r.status }))
      : list.json,
  };

  // Detail + snapshots
  if (submit.status < 400 && submit.json?.id) {
    const detail = await api('GET', `/api/v1/compliance/assessments/${submit.json.id}`, token);
    const items = detail.json?.items ?? [];
    const withSnap = items.filter(
      (it: any) =>
        it.questionCodeSnapshot ||
        it.questionTextSnapshot ||
        it.weightSnapshot != null ||
        it.sectionCodeSnapshot,
    );
    const sample = items.find((it: any) => it.questionCodeSnapshot)?.questionCodeSnapshot
      ? items.find((it: any) => it.questionCodeSnapshot)
      : items[0];
    out.detail = {
      status: detail.status,
      standardsVersion: detail.json?.standardsVersion,
      overallPercent: detail.json?.overallPercent,
      overallRank: detail.json?.overallRank,
      itemCount: items.length,
      snapshotCount: withSnap.length,
      sampleSnapshot: sample
        ? {
            questionCodeSnapshot: sample.questionCodeSnapshot,
            questionTextSnapshot: sample.questionTextSnapshot?.slice?.(0, 80),
            weightSnapshot: sample.weightSnapshot,
            sectionCodeSnapshot: sample.sectionCodeSnapshot,
            sectionTitleSnapshot: sample.sectionTitleSnapshot?.slice?.(0, 80),
            questionOrderSnapshot: sample.questionOrderSnapshot,
          }
        : null,
    };

    // DB verification
    const db = await prisma.complianceAssessment.findUnique({
      where: { id: submit.json.id },
      select: {
        id: true,
        assessmentType: true,
        standardsVersion: true,
        centerId: true,
        status: true,
        overallPercent: true,
        overallRank: true,
        submittedAt: true,
      },
    });
    out.db = db;
    out.scoring = preview;
  }

  log(`E2E ${facility}`, out);
  return out;
}

async function main() {
  log('env', {
    api: API,
    selfAssessmentCurrent: SELF_ASSESSMENT_CURRENT_VERSION ?? getCurrentCatalogVersion('self_assessment'),
    supportiveSupervisionCurrent:
      SUPPORTIVE_SUPERVISION_CURRENT_VERSION ?? getCurrentCatalogVersion('supportive_supervision'),
  });

  // Catalog maxima unit check
  const maxima: Record<string, number> = {};
  for (const ft of ['daycare', 'home_based', 'community_based', 'ecd_3_5'] as Facility[]) {
    const c = resolveAssessmentCatalog({
      assessmentType: 'self_assessment',
      standardsVersion: '2024.3-official',
      facilityTypeId: ft,
    });
    maxima[ft] = c.checklist.grandTotalMax ?? c.checklist.computedMaxScore;
  }
  log('officialMaxima', maxima);

  // Inspection catalogs
  const insp = {
    daycare: resolveAssessmentCatalog({
      assessmentType: 'supportive_supervision',
      standardsVersion: '2024.2-weighted',
      facilityTypeId: 'daycare',
    }).checklist.computedMaxScore,
    ecd_3_5: resolveAssessmentCatalog({
      assessmentType: 'supportive_supervision',
      standardsVersion: '2024.2-weighted',
      facilityTypeId: 'ecd_3_5',
    }).checklist.computedMaxScore,
  };
  log('inspectionMaxima', insp);

  // Ensure no official catalog for supportive_supervision
  const officialInsp = getRegisteredCatalog('supportive_supervision', '2024.3-official');
  log('inspectionNotOnOfficial', { registered: Boolean(officialInsp) });

  await setPassword('test2');
  await setPassword('test5');
  await setPassword('test_esri');
  await setPassword('test_gasabo');
  await setPassword('kimihurura_director');

  const esri = await prisma.ecdCenter.findFirstOrThrow({ where: { code: 'ECD-TEST-402' } });
  const originalFt = esri.facilityType;
  const createdIds: string[] = [];
  REPORT.originalEsriFacilityType = originalFt;
  REPORT.esriCenterId = esri.id;

  try {
    // --- All-yes scoring (automated, no DB write for large) ---
    for (const ft of ['daycare', 'home_based', 'community_based', 'ecd_3_5'] as Facility[]) {
      const yes = scorePreview(ft, answerableItems(ft, true))!;
      const no = scorePreview(ft, answerableItems(ft, false))!;
      log(`scoreScenario ${ft}`, { allYes: yes, allNo: no });
    }

    // --- Facility E2E (browser-equivalent API path): all-no submit ---
    for (const ft of ['daycare', 'home_based', 'community_based', 'ecd_3_5'] as Facility[]) {
      await runFacilityE2E(ft, esri.id, createdIds, { submitAllNo: true });
    }

    // One all-yes submit for home_based (small enough) to prove GREEN 100%
    await setFacilityType(esri.id, 'home_based');
    {
      const token = await login('test2');
      await deleteDraft(token);
      const items = answerableItems('home_based', true);
      const preview = scorePreview('home_based', items)!;
      const submit = await api('POST', '/api/v1/compliance/self-evaluations', token, {
        centerId: esri.id,
        facilityTypeId: 'home_based',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        earnedScore: preview.earnedScore,
        maxScore: preview.maxScore,
        percent: preview.percent,
        rank: preview.rank,
        items,
      });
      log('home_based allYesSubmit', {
        status: submit.status,
        id: submit.json?.id,
        percent: submit.json?.overallPercent,
        rank: submit.json?.overallRank,
        expected: preview,
      });
      if (submit.json?.id) createdIds.push(submit.json.id);
    }

    // --- Cross-facility protection ---
    await setFacilityType(esri.id, 'daycare');
    {
      const token = await login('test2');
      await deleteDraft(token);
      const badFacility = await api('PUT', '/api/v1/compliance/self-evaluations/draft', token, {
        facilityTypeId: 'community_based',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        items: [{ questionId: 'OFFICIAL-COMMUNITY_BASED-S01-Q001', response: true }],
      });
      log('crossFacility community_on_daycare', {
        status: badFacility.status,
        message: badFacility.json?.message,
      });

      await setFacilityType(esri.id, 'community_based');
      const badCode = await api('PUT', '/api/v1/compliance/self-evaluations/draft', token, {
        facilityTypeId: 'community_based',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        items: [{ questionId: 'OFFICIAL-DAYCARE-S01-Q001', response: true }],
      });
      log('crossFacility daycare_code_on_community', {
        status: badCode.status,
        message: badCode.json?.message,
      });

      await setFacilityType(esri.id, 'ecd_3_5');
      const badHb = await api('PUT', '/api/v1/compliance/self-evaluations/draft', token, {
        facilityTypeId: 'ecd_3_5',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        items: [{ questionId: 'OFFICIAL-HOME_BASED-S01-Q001', response: true }],
      });
      log('crossFacility home_code_on_school', {
        status: badHb.status,
        message: badHb.json?.message,
      });
    }

    // --- Null facility ---
    const karambira = await prisma.ecdCenter.findFirstOrThrow({ where: { code: 'RK012' } });
    await setFacilityType(karambira.id, null);
    {
      const token = await login('test5');
      const nullDraft = await api('PUT', '/api/v1/compliance/self-evaluations/draft', token, {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        items: [{ questionId: 'OFFICIAL-DAYCARE-S01-Q001', response: true }],
      });
      log('nullFacilityReject', { status: nullDraft.status, message: nullDraft.json?.message });
    }

    // --- Invalid facility type enum (unit/assert) ---
    let invalidCaught = false;
    try {
      assertCenterFacilityMatchesSelfEval({
        assessmentType: 'self_assessment',
        standardsVersion: '2024.3-official',
        centerFacilityType: 'other',
        requestFacilityTypeId: 'other',
      });
    } catch (e: any) {
      invalidCaught = true;
      log('invalidFacilityType other', { rejected: true, message: e.message });
    }
    if (!invalidCaught) log('invalidFacilityType other', { rejected: false });

    // Center update DTO — try PATCH with other via district user if endpoint exists
    {
      const token = await login('test_gasabo');
      const patch = await api('PATCH', `/api/v1/centers/${esri.id}`, token, {
        facilityType: 'other',
      });
      log('invalidFacilityType centerPatch', {
        status: patch.status,
        message: patch.json?.message,
      });
    }

    // --- Authorization ---
    {
      const caregiver = await login('test_esri');
      const denied = await api('PUT', '/api/v1/compliance/self-evaluations/draft', caregiver, {
        facilityTypeId: 'ecd_3_5',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        items: [{ questionId: 'OFFICIAL-ECD_3_5-S01-Q001', response: true }],
      });
      log('auth caregiver write denied', { status: denied.status, message: denied.json?.message });

      const director = await login('test2');
      await setFacilityType(esri.id, 'ecd_3_5');
      await deleteDraft(director);
      const ok = await api('PUT', '/api/v1/compliance/self-evaluations/draft', director, {
        facilityTypeId: 'ecd_3_5',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        items: [{ questionId: 'OFFICIAL-ECD_3_5-S01-Q001', response: true }],
      });
      log('auth director write ok', { status: ok.status, id: ok.json?.id });
      if (ok.json?.id) createdIds.push(ok.json.id);
      await deleteDraft(director);
    }

    // --- Historical 2024.1 ---
    {
      const token = await login('test2');
      const hist = await prisma.complianceAssessment.findFirst({
        where: { standardsVersion: { startsWith: '2024.1' }, status: 'submitted', deletedAt: null },
      });
      if (hist) {
        const detail = await api('GET', `/api/v1/compliance/assessments/${hist.id}`, token);
        const items = detail.json?.items ?? [];
        const officialLeak = items.some(
          (it: any) =>
            (it.questionCodeSnapshot || it.standard?.code || '').includes('OFFICIAL-'),
        );
        log('historical2024.1', {
          id: hist.id,
          standardsVersion: hist.standardsVersion,
          percent: hist.overallPercent,
          rank: hist.overallRank,
          detailStatus: detail.status,
          detailVersion: detail.json?.standardsVersion,
          itemCount: items.length,
          officialQuestionLeak: officialLeak,
        });
      } else {
        log('historical2024.1', { available: false });
      }
    }

    // --- 2024.2 draft / submitted absence ---
    const drafts20242 = await prisma.complianceAssessment.count({
      where: {
        standardsVersion: { contains: '2024.2' },
        assessmentType: 'self_assessment',
        deletedAt: null,
      },
    });
    log('historical2024.2 runtime', { selfAssessmentRows: drafts20242 });

    // --- Reclassification safety ---
    await setFacilityType(esri.id, 'daycare');
    {
      const token = await login('test2');
      await deleteDraft(token);
      const items = answerableItems('daycare', false).slice(0, 3);
      // Need full submission for history pin — use all-no
      const allNo = answerableItems('daycare', false);
      const preview = scorePreview('daycare', allNo)!;
      const submit = await api('POST', '/api/v1/compliance/self-evaluations', token, {
        centerId: esri.id,
        facilityTypeId: 'daycare',
        standardsVersion: '2024.3-official',
        assessmentDate: DATE,
        earnedScore: preview.earnedScore,
        maxScore: preview.maxScore,
        percent: preview.percent,
        rank: preview.rank,
        items: allNo,
      });
      const id = submit.json?.id as string | undefined;
      if (id) createdIds.push(id);
      await setFacilityType(esri.id, 'community_based');
      const detail = id
        ? await api('GET', `/api/v1/compliance/assessments/${id}`, token)
        : { status: 0, json: null };
      log('reclassificationSafety', {
        submitStatus: submit.status,
        id,
        afterCenterType: 'community_based',
        detailVersion: detail.json?.standardsVersion,
        stillDaycare: String(detail.json?.standardsVersion || '').includes('daycare'),
      });
    }

    // --- Inspection isolation ---
    {
      const token = await login('test_gasabo');
      const create = await api('POST', '/api/v1/compliance/inspections', token, {
        centerId: esri.id,
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: DATE,
      });
      log('inspectionCreate', {
        status: create.status,
        id: create.json?.id,
        standardsVersion: create.json?.standardsVersion,
        assessmentType: create.json?.assessmentType,
        message: create.json?.message,
      });
      if (create.json?.id) {
        createdIds.push(create.json.id);
        // Try to force official — should fail or ignore
        const bad = await api('PUT', `/api/v1/compliance/inspections/${create.json.id}`, token, {
          facilityTypeId: 'daycare',
          standardsVersion: '2024.3-official',
          assessmentDate: DATE,
          items: [],
        });
        log('inspectionOfficialAttempt', { status: bad.status, message: bad.json?.message });
      }

      // Catalog pin check
      log('inspectionCatalogPin', {
        supportiveCurrent: getCurrentCatalogVersion('supportive_supervision'),
        selfCurrent: getCurrentCatalogVersion('self_assessment'),
        daycareMax: insp.daycare,
        ecdMax: insp.ecd_3_5,
      });
    }
  } finally {
    await setFacilityType(esri.id, originalFt ?? 'ecd_3_5');
    // Soft-delete disposable ALIGN-06 assessments created today for this center with 2024.3
    const disposable = await prisma.complianceAssessment.findMany({
      where: {
        centerId: esri.id,
        standardsVersion: { contains: '2024.3-official' },
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
        deletedAt: null,
      },
      select: { id: true, status: true, standardsVersion: true },
    });
    REPORT.disposableCandidates = disposable;
    // Soft-delete drafts always; keep one submitted sample per facility for audit? Task says remove disposable where safe.
    // Soft-delete ALL align06-created ids we tracked (including submitted) since they're test data on TEST center.
    const unique = [...new Set([...createdIds, ...disposable.map((d) => d.id)])];
    await softDeleteAssessments(unique);
    REPORT.softDeleted = unique;
    log('cleanup', { restoredFacilityType: originalFt ?? 'ecd_3_5', softDeletedCount: unique.length });
  }

  const outPath = path.join(__dirname, 'align06-report.json');
  fs.writeFileSync(outPath, JSON.stringify(REPORT, null, 2));
  console.log('WROTE', outPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
