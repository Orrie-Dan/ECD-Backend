import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

interface PortalTokenResponse {
  token: string;
  expires: number;
}

type PortalToken = PortalTokenResponse;

@Injectable()
export class GisService {
  private readonly logger = new Logger(GisService.name);
  private cachedToken: PortalToken | null = null;

  constructor(private readonly config: ConfigService) {}

  get portalUrl(): string {
    return (
      this.config.get<string>('ARCGIS_PORTAL_URL') || 'https://infrastructure.space.gov.rw/portal'
    ).replace(/\/$/, '');
  }

  /**
   * Referer bound into Portal tokens. Federated ArcGIS Server (/server/rest)
   * rejects `client=requestip` tokens with 498; referer tokens work for both
   * Portal sharing REST and hosted feature services.
   */
  get tokenReferer(): string {
    const configured = this.config.get<string>('ARCGIS_TOKEN_REFERER')?.trim();
    if (configured) return configured;
    try {
      return new URL(this.portalUrl).origin;
    } catch {
      return 'https://infrastructure.space.gov.rw';
    }
  }

  private get allowedHosts(): Set<string> {
    const raw = this.config.get<string>('ARCGIS_ALLOWED_HOSTS') || 'infrastructure.space.gov.rw';
    return new Set(
      raw
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private credentialsConfigured(): boolean {
    return Boolean(
      this.config.get<string>('ARCGIS_USERNAME') && this.config.get<string>('ARCGIS_PASSWORD'),
    );
  }

  private assertAllowedTarget(targetUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new ForbiddenException('Invalid proxy target URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new ForbiddenException('Only HTTPS proxy targets are allowed');
    }

    if (!this.allowedHosts.has(parsed.hostname.toLowerCase())) {
      throw new ForbiddenException(`GIS proxy host not allowed: ${parsed.hostname}`);
    }

    return parsed;
  }

  async getToken(): Promise<PortalTokenResponse> {
    if (!this.credentialsConfigured()) {
      throw new ServiceUnavailableException(
        'ArcGIS portal credentials are not configured (ARCGIS_USERNAME / ARCGIS_PASSWORD)',
      );
    }

    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expires > now + 60_000) {
      return this.cachedToken;
    }

    const username = this.config.get<string>('ARCGIS_USERNAME')!;
    const password = this.config.get<string>('ARCGIS_PASSWORD')!;
    const expirationMinutes = this.config.get<string>('ARCGIS_TOKEN_EXPIRATION_MINUTES') || '60';

    const body = new URLSearchParams({
      username,
      password,
      client: 'referer',
      referer: this.tokenReferer,
      expiration: expirationMinutes,
      f: 'json',
    });

    const response = await fetch(`${this.portalUrl}/sharing/rest/generateToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = (await response.json()) as {
      token?: string;
      expires?: number;
      error?: { message?: string };
    };

    if (!response.ok || !data.token || !data.expires) {
      const message = data.error?.message || 'ArcGIS token request failed';
      this.logger.error(`ArcGIS generateToken failed: ${message}`);
      throw new BadGatewayException(message);
    }

    this.cachedToken = { token: data.token, expires: data.expires };
    return this.cachedToken;
  }

  async proxyRequest(
    targetUrl: string,
    req: Request,
  ): Promise<{ status: number; body: Buffer; contentType: string }> {
    const parsed = this.assertAllowedTarget(targetUrl);

    if (this.credentialsConfigured()) {
      try {
        const { token } = await this.getToken();
        if (!parsed.searchParams.has('token')) {
          parsed.searchParams.set('token', token);
        }
      } catch (error) {
        this.logger.warn(
          `GIS token unavailable for proxy request; continuing without token: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const headers: Record<string, string> = {};
    const contentType = req.headers['content-type'];
    if (contentType) {
      headers['Content-Type'] = Array.isArray(contentType) ? contentType[0] : contentType;
    }

    if (this.credentialsConfigured()) {
      headers.Referer = this.tokenReferer;
    }

    const init: RequestInit = {
      method: req.method,
      headers,
    };

    if (!['GET', 'HEAD'].includes(req.method)) {
      if (typeof req.body === 'string') {
        init.body = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        init.body = Uint8Array.from(req.body);
      } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        init.body = new URLSearchParams(req.body as Record<string, string>).toString();
      }
    }

    const upstream = await fetch(parsed.toString(), init);
    const body = Buffer.from(await upstream.arrayBuffer());
    const upstreamType = upstream.headers.get('content-type') || 'application/json';

    return {
      status: upstream.status,
      body,
      contentType: upstreamType,
    };
  }
}
