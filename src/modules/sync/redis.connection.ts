import { ConfigService } from '@nestjs/config';

/**
 * BullMQ/ioredis connection from env.
 *
 * Failure being fixed: production Redis (Render/Redis Cloud) typically requires
 * REDIS_URL and often TLS/password. Host+port only silently cannot apply sessions.
 *
 * Why minimal: prefer REDIS_URL when set; otherwise keep REDIS_HOST/PORT.
 * maxRetriesPerRequest must be null for BullMQ blocking connections.
 */
export function buildRedisConnection(config: ConfigService): {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
} {
  const url = config.get<string>('REDIS_URL')?.trim();
  const password = config.get<string>('REDIS_PASSWORD')?.trim() || undefined;
  const tlsFlag = config.get<string>('REDIS_TLS')?.trim();
  const tlsExplicit = tlsFlag === 'true' || tlsFlag === '1';

  if (url) {
    const useTls = tlsExplicit || url.startsWith('rediss://');
    return {
      url,
      maxRetriesPerRequest: null,
      ...(password ? { password } : {}),
      ...(useTls ? { tls: {} } : {}),
    };
  }

  return {
    host: config.get<string>('REDIS_HOST', '127.0.0.1'),
    port: Number(config.get<string>('REDIS_PORT', '6379')),
    ...(password ? { password } : {}),
    ...(tlsExplicit ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
