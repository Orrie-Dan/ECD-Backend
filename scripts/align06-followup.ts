import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  getAnswerableQuestions,
  scoreSelfEvaluationFromAnswers,
} from '../src/modules/compliance/self-eval-catalog';

const prisma = new PrismaClient();
const API = 'http://localhost:3000';
const PASS = process.env.ALIGN06_TEMP_PASSWORD || 'Align06-AuditTmp!';

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
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
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function login(username: string) {
  const r = await api('POST', '/api/v1/auth/login', undefined, { username, password: PASS });
  return r.json.accessToken as string;
}

async function main() {
  await prisma.$executeRaw`
    UPDATE sde.user_account
    SET password_hash = ${await bcrypt.hash(PASS, 10)}, password_changed_at = now()
    WHERE username IN ('test2', 'kimihurura_director', 'test5')
  `;

  // Historical 2024.1 on ESRI (owned by test2)
  const histEsri = await prisma.complianceAssessment.findFirst({
    where: {
      centerId: '9b754e5c-9058-4aa1-8946-94b9ec3903ee',
      standardsVersion: { startsWith: '2024.1' },
      deletedAt: null,
    },
  });
  const t2 = await login('test2');
  if (histEsri) {
    const d = await api('GET', `/api/v1/compliance/assessments/${histEsri.id}`, t2);
    const items = d.json?.items ?? [];
    const leak = items.some((it: any) =>
      String(it.questionCodeSnapshot || it.standard?.code || '').includes('OFFICIAL-'),
    );
    console.log(
      'hist2024.1_esri',
      JSON.stringify({
        id: histEsri.id,
        version: histEsri.standardsVersion,
        percent: histEsri.overallPercent,
        rank: histEsri.overallRank,
        detailStatus: d.status,
        detailVersion: d.json?.standardsVersion,
        itemCount: items.length,
        officialLeak: leak,
      }),
    );
  }

  // Historical 2024.1 daycare on Kimihurura
  const histK = await prisma.complianceAssessment.findFirst({
    where: {
      centerId: '8fddf915-f0bd-4494-93cd-084bcf169c01',
      standardsVersion: { startsWith: '2024.1' },
      deletedAt: null,
    },
  });
  const kd = await login('kimihurura_director');
  if (histK) {
    const d = await api('GET', `/api/v1/compliance/assessments/${histK.id}`, kd);
    console.log(
      'hist2024.1_kimihurura',
      JSON.stringify({
        id: histK.id,
        version: histK.standardsVersion,
        percent: histK.overallPercent,
        rank: histK.overallRank,
        detailStatus: d.status,
        detailVersion: d.json?.standardsVersion,
        itemCount: (d.json?.items ?? []).length,
      }),
    );
  }

  // Full snapshot sample — home_based all-yes, leave soft-deleted after inspect
  const esriId = '9b754e5c-9058-4aa1-8946-94b9ec3903ee';
  const original = (
    await prisma.ecdCenter.findUniqueOrThrow({ where: { id: esriId } })
  ).facilityType;
  await prisma.ecdCenter.update({ where: { id: esriId }, data: { facilityType: 'home_based' } });
  try {
    await api('DELETE', '/api/v1/compliance/self-evaluations/draft', t2);
    const items = [...getAnswerableQuestions('home_based', '2024.3-official').keys()].map(
      (questionId) => ({ questionId, response: true }),
    );
    const score = scoreSelfEvaluationFromAnswers(
      'home_based',
      Object.fromEntries(items.map((i) => [i.questionId, i.response])),
      '2024.3-official',
    )!;
    const submit = await api('POST', '/api/v1/compliance/self-evaluations', t2, {
      centerId: esriId,
      facilityTypeId: 'home_based',
      standardsVersion: '2024.3-official',
      assessmentDate: new Date().toISOString().slice(0, 10),
      earnedScore: score.earnedScore,
      maxScore: score.maxScore,
      percent: score.percent,
      rank: score.rank,
      items,
    });
    const detail = await api('GET', `/api/v1/compliance/assessments/${submit.json.id}`, t2);
    const answerItems = (detail.json?.items ?? []).filter(
      (it: any) => it.questionCodeSnapshot && it.questionCodeSnapshot !== 'SELF-EVAL-SCORE',
    );
    const complete = answerItems.filter(
      (it: any) =>
        it.questionCodeSnapshot &&
        it.questionTextSnapshot &&
        it.weightSnapshot != null &&
        it.sectionCodeSnapshot &&
        it.sectionTitleSnapshot &&
        it.questionOrderSnapshot != null,
    );
    console.log(
      'snapshotFull',
      JSON.stringify({
        submitStatus: submit.status,
        id: submit.json?.id,
        percent: submit.json?.overallPercent,
        rank: submit.json?.overallRank,
        answerItems: answerItems.length,
        completeSnapshots: complete.length,
        sample: complete[0]
          ? {
              questionCodeSnapshot: complete[0].questionCodeSnapshot,
              weightSnapshot: complete[0].weightSnapshot,
              sectionCodeSnapshot: complete[0].sectionCodeSnapshot,
              questionOrderSnapshot: complete[0].questionOrderSnapshot,
            }
          : null,
      }),
    );
    if (submit.json?.id) {
      await prisma.complianceAssessment.update({
        where: { id: submit.json.id },
        data: { deletedAt: new Date() },
      });
    }
  } finally {
    await prisma.ecdCenter.update({
      where: { id: esriId },
      data: { facilityType: original ?? 'ecd_3_5' },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
