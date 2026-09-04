/**
 * GIS BFF tests.
 * Run: npx ts-node src/modules/gis/__tests__/gis.service.spec.ts
 */
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GisService } from '../gis.service';

function assert(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (e) {
      console.error(`FAIL: ${name}`);
      throw e;
    }
  })();
}

function eq(actual: unknown, expected: unknown, label?: string) {
  if (actual !== expected) {
    throw new Error(`${label ?? 'eq'} expected ${expected} got ${actual}`);
  }
}

function createService(env: Record<string, string> = {}): GisService {
  const config = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as ConfigService;
  return new GisService(config);
}

async function main() {
  await assert('tokenReferer defaults to portal origin', () => {
    const service = createService({
      ARCGIS_PORTAL_URL: 'https://infrastructure.space.gov.rw/portal',
    });
    eq(service.tokenReferer, 'https://infrastructure.space.gov.rw');
  });

  await assert('tokenReferer respects ARCGIS_TOKEN_REFERER override', () => {
    const service = createService({
      ARCGIS_PORTAL_URL: 'https://infrastructure.space.gov.rw/portal',
      ARCGIS_TOKEN_REFERER: 'https://ecd.example.gov.rw',
    });
    eq(service.tokenReferer, 'https://ecd.example.gov.rw');
  });

  await assert('proxy rejects disallowed hostnames', async () => {
    const service = createService({
      ARCGIS_ALLOWED_HOSTS: 'infrastructure.space.gov.rw',
    });
    let threw = false;
    try {
      await service.proxyRequest('https://evil.example.com/rest/services', {
        method: 'GET',
        headers: {},
      } as import('express').Request);
    } catch (error) {
      threw = error instanceof ForbiddenException;
    }
    eq(threw, true, 'ForbiddenException thrown');
  });

  await assert(
    'generateToken uses referer client against live portal when configured',
    async () => {
      const username = process.env.ARCGIS_USERNAME;
      const password = process.env.ARCGIS_PASSWORD;
      if (!username || !password) {
        console.log('SKIP: generateToken live test (ARCGIS_USERNAME/PASSWORD not set)');
        return;
      }

      const service = createService({
        ARCGIS_PORTAL_URL:
          process.env.ARCGIS_PORTAL_URL || 'https://infrastructure.space.gov.rw/portal',
        ARCGIS_USERNAME: username,
        ARCGIS_PASSWORD: password,
        ARCGIS_TOKEN_REFERER:
          process.env.ARCGIS_TOKEN_REFERER || 'https://infrastructure.space.gov.rw',
      });

      const { token } = await service.getToken();
      if (!token) throw new Error('expected token');

      const layerUrl = `https://infrastructure.space.gov.rw/server/rest/services/ECD_Mapping_Form/FeatureServer/0?f=json&token=${encodeURIComponent(token)}`;
      const response = await fetch(layerUrl, { headers: { Referer: service.tokenReferer } });
      const data = (await response.json()) as { error?: { code?: number }; name?: string };
      if (data.error?.code === 498) {
        throw new Error('referer token still invalid for federated feature server');
      }
      eq(data.name, 'ECD_Mapping_Form');
    },
  );

  console.log('All GIS service tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
