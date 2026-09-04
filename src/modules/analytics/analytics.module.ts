import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { DistrictRiskService } from './district-risk.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, DistrictRiskService],
  exports: [AnalyticsService, DistrictRiskService],
})
export class AnalyticsModule {}
