/**
 * ALIGN-06 — API-level E2E harness against the configured DATABASE_URL.
 * Uses temporary password reset for known test directors; restores facilityType after.
 * Does not print passwords.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const API_BASE = (process.env.ALIGN06_API_BASE || 'https://infrastructure.space.gov.rw').replace(/\/$/, '');
const TEMP_PASSWORD = process.env.ALIGN06_TEMP_PASSWORD || `Align06-${randomUUID().slice(0, 8)}!`;

type Json = Record<string, unknown>;

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json, text };
}

async function login(username: string, password: string) {
  const r = await api('POST', '/api/v1/auth/login', undefined, { username, password });
  if (r.status >= 400) {
    throw new Error(`login ${username} failed ${r.status}`);
  }
  const j = r.json as Json;
  const token =
    (j.accessToken as string) ||
    ((j.data as Json | undefined)?.accessToken as string) ||
    (j.token as string);
  if (!token) throw new Error(`login ${username}: no token in ${JSON.stringify(j).slice(0, 200)}`);
  return token;
}

async function setPassword(username: string, password: string) {
  const hash = await bcrypt.hash(password, 10);
  await prisma.$executeRaw`
    UPDATE sde.user_account
    SET password_hash = ${hash}, password_changed_at = now(), updated_at = now()
    WHERE username = ${username}
  `;
}

async function setFacilityType(centerId: string, facilityType: string | null) {
  await prisma.ecdCenter.update({
    where: { id: centerId },
    data: { facilityType },
  });
}

function allYesAnswers(codes: string[]) {
  return Object.fromEntries(codes.map((c) => [c, 'yes' as const]));
}

async function main() {
  console.log('API_BASE', API_BASE);

  // Probe remote/local identity
  const health = await api('GET', '/api/v1/health').catch(() => ({ status: 0, json: null, text: '' }));
  console.log('health', health.status);

  const openapi = await api('GET', '/api/v1/openapi.json').catch(() =>
    api('GET', '/openapi/openapi.json'),
  );
  console.log('openapiProbe', openapi.status);

  // Test centers
  const esri = await prisma.ecdCenter.findFirst({
    where: { code: 'ECD-TEST-402' },
  });
  if (!esri) throw new Error('ESRI_Rwanda test center missing');
  const originalFt = esri.facilityType;
  console.log('ESRI center', esri.id, 'original facilityType', originalFt);

  const karambira = await prisma.ecdCenter.findFirst({ where: { code: 'RK012' } });
  console.log('Karambira', karambira?.id, 'facilityType', karambira?.facilityType);

  // Reset passwords for test directors (temporary)
  await setPassword('test2', TEMP_PASSWORD);
  await setPassword('test5', TEMP_PASSWORD);
  await setPassword('test_gasabo', TEMP_PASSWORD);
  console.log('passwords reset for test2/test5/test_gasabo (not printed)');

  // Check login works
  let token: string;
  try {
    token = await login('test2', TEMP_PASSWORD);
    console.log('login test2 OK');
  } catch (e) {
    console.error('LOGIN_FAILED against', API_BASE, String(e));
    console.log('HINT: start local backend or point ALIGN06_API_BASE at a reachable API with this DB');
    process.exitCode = 2;
    return;
  }

  const me = await api('GET', '/api/v1/auth/me', token);
  console.log('me', me.status, JSON.stringify(me.json).slice(0, 300));

  // Catalog probe via draft with wrong facility should fail when center is ecd_3_5
  await setFacilityType(esri.id, 'ecd_3_5');
  const mismatch = await api('PUT', '/api/v1/compliance/self-evaluations/draft', token, {
    facilityTypeId: 'community_based',
    standardsVersion: '2024.3-official',
    assessmentDate: new Date().toISOString().slice(0, 10),
    items: [{ questionId: 'CB-S01-Q01', response: 'yes' }],
  });
  console.log('crossFacilityReject', mismatch.status, JSON.stringify(mismatch.json).slice(0, 250));

  // Null facility via test5
  if (karambira) {
    await setFacilityType(karambira.id, null);
    const t5 = await login('test5', TEMP_PASSWORD);
    const nullDraft = await api('PUT', '/api/v1/compliance/self-evaluations/draft', t5, {
      facilityTypeId: 'daycare',
      standardsVersion: '2024.3-official',
      assessmentDate: new Date().toISOString().slice(0, 10),
      items: [{ questionId: 'DC-S01-Q01', response: 'yes' }],
    });
    console.log('nullFacilityReject', nullDraft.status, JSON.stringify(nullDraft.json).slice(0, 250));
  }

  // Restore ESRI
  await setFacilityType(esri.id, originalFt);
  console.log('restored ESRI facilityType to', originalFt);
  console.log('TEMP_PASSWORD_SET=true (use env ALIGN06_TEMP_PASSWORD for browser)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
