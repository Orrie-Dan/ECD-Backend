import { All, BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { GisService } from './gis.service';

@ApiTags('gis')
@Controller('gis')
export class GisController {
  constructor(private readonly gisService: GisService) {}

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
