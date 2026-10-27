import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ChildrenConditionsService } from './children-conditions.service';
import { DistrictRiskService } from './district-risk.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, DistrictRiskService, ChildrenConditionsService],
  exports: [AnalyticsService, DistrictRiskService],
})
export class AnalyticsModule {}
