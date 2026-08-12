import { ConfigService } from '@nestjs/config';
import { buildRedisConnection } from '../redis.connection';

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
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

function config(map: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, fallback?: string) =>
      map[key] !== undefined ? map[key] : fallback,
  } as ConfigService;
}

assert('uses REDIS_URL when set', () => {
  const conn = buildRedisConnection(
    config({ REDIS_URL: 'rediss://:secret@example.com:6380' }),
  );
  eq(conn.url, 'rediss://:secret@example.com:6380');
  eq(conn.maxRetriesPerRequest, null);
  eq(Boolean(conn.tls), true, 'rediss implies tls');
});

assert('falls back to host/port', () => {
  const conn = buildRedisConnection(
    config({ REDIS_HOST: '10.0.0.2', REDIS_PORT: '6381' }),
  );
  eq(conn.host, '10.0.0.2');
  eq(conn.port, 6381);
  eq(conn.url, undefined);
  eq(conn.maxRetriesPerRequest, null);
});

assert('honors REDIS_PASSWORD and REDIS_TLS on host/port', () => {
  const conn = buildRedisConnection(
    config({
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'p',
      REDIS_TLS: 'true',
    }),
  );
  eq(conn.password, 'p');
  eq(Boolean(conn.tls), true);
});

console.log('\nAll redis connection tests passed.');
