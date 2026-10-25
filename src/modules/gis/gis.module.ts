import { Module } from '@nestjs/common';
import { CenterDirectoryCache } from './center-metrics/center-directory.cache';
import { CenterMetricsService } from './center-metrics/center-metrics.service';
import { GisController } from './gis.controller';
import { GisService } from './gis.service';

@Module({
  controllers: [GisController],
  providers: [GisService, CenterMetricsService, CenterDirectoryCache],
  exports: [GisService],
})
export class GisModule {}
