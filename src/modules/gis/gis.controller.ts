import { UserRole } from '../../common/domain';
import {
  All,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CenterMetricsQueryDto } from './center-metrics/center-metrics-query.dto';
import { CenterMetricsResponseDto } from './center-metrics/center-metrics-response.dto';
import { CenterMetricsService } from './center-metrics/center-metrics.service';
import { GisService } from './gis.service';

@ApiTags('gis')
@Controller('gis')
export class GisController {
  private readonly logger = new Logger(GisController.name);

  constructor(
    private readonly gisService: GisService,
    private readonly centerMetricsService: CenterMetricsService,
  ) {}

  @Get('center-metrics')
  @ApiBearerAuth()
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Per-center map metrics',
    description:
      'Enrollment, attendance rate, latest self-evaluation and stunting rate for every mapped ' +
      'center in scope (NCDA: national, province, district or narrower; district/sector users ' +
      'are pinned to their assignment). Aggregates only — no child-level data.',
  })
  @ApiOkResponse({ type: CenterMetricsResponseDto })
  @ApiStandardClientErrors()
  centerMetrics(@CurrentUser() user: AuthUser, @Query() query: CenterMetricsQueryDto) {
    return this.centerMetricsService.centerMetrics(user, query);
  }

  @Post('map-unsupported')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Report a browser that cannot draw ArcGIS maps',
    description:
      'Sent once per page load when the browser lacks WebGL2. Writes one structured server log ' +
      'line (user, role, district, browser) so affected users can be counted. Nothing is stored.',
  })
  @ApiNoContentResponse()
  @ApiStandardClientErrors()
  mapUnsupported(@CurrentUser() user: AuthUser, @Req() req: Request): void {
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
    this.logger.warn(
      `map-unsupported ${JSON.stringify({
        userId: user.id,
        role: user.role,
        districtId: user.districtId,
        sectorId: user.sectorId,
        userAgent,
      })}`,
    );
  }

  @Public()
  @Get('token')
  @ApiOperation({
    summary: 'ArcGIS portal token',
    description:
      'Server-side Portal token for map embeds. Credentials come from ARCGIS_USERNAME / ARCGIS_PASSWORD.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        expires: { type: 'number' },
      },
    },
  })
  async getToken(): Promise<{ token: string; expires: number }> {
    return this.gisService.getToken();
  }

  @Public()
  @All('proxy')
  @ApiOperation({
    summary: 'ArcGIS REST proxy (CORS bypass)',
    description:
      'Forwards browser map requests to the Portal/ArcGIS Server with server-side credentials. ' +
      'Pass the full target URL as the `url` query parameter.',
  })
  async proxy(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const rawUrl = query.url;
    const targetUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
    if (!targetUrl?.trim()) {
      throw new BadRequestException('url query parameter is required');
    }

    const resolvedTargetUrl = this.mergeProxyQueryParams(targetUrl.trim(), query);
    const result = await this.gisService.proxyRequest(resolvedTargetUrl, req);
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.body);
  }

  /**
   * ArcGIS JS API appends `f=json` etc. as sibling query params on the proxy URL.
   * Merge them into the encoded target `url` before forwarding.
   */
  private mergeProxyQueryParams(
    targetUrl: string,
    query: Record<string, string | string[] | undefined>,
  ): string {
    const parsed = new URL(targetUrl);

    for (const [key, value] of Object.entries(query)) {
      if (key === 'url' || value === undefined) {
        continue;
      }
      const resolved = Array.isArray(value) ? value[0] : value;
      if (!parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, resolved);
      }
    }

    return parsed.toString();
  }
}
