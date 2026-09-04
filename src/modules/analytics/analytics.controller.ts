import { UserRole } from '../../common/domain';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { AnalyticsService } from './analytics.service';
import { DistrictRiskService } from './district-risk.service';
import { ChildrenDemographicsQueryDto } from './dto/children-demographics-query.dto';
import { ChildrenDemographicsResponseDto } from './dto/children-demographics-response.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';
import { DistrictRiskQueryDto } from './dto/district-risk-query.dto';
import { DistrictRiskResponseDto } from './dto/district-risk-response.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly districtRiskService: DistrictRiskService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Get analytics dashboard',
    description:
      'Aggregate KPI snapshot for children, attendance, nutrition, referrals, and feeding in the selected scope/date range.',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  @ApiStandardClientErrors()
  getDashboard(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.analyticsService.getDashboard(user, query);
  }

  @Get('children-demographics')
  @ApiOperation({
    summary: 'Children demographic breakdown (dashboard drill-down)',
    description:
      'Scoped snapshot for the admin dashboard "total children" KPI click-through: ' +
      'active children by gender, age band (0–2 / 3–6 / 6+), and disability; ' +
      'caregiver and supporting-staff (ecd_director) rollups; children-per-caregiver ratio; ' +
      'and boys/girls totals per in-scope district. Uses the same districtId/centerId scope as /analytics/dashboard.',
  })
  @ApiOkResponse({ type: ChildrenDemographicsResponseDto })
  @ApiStandardClientErrors()
  getChildrenDemographics(
    @CurrentUser() user: AuthUser,
    @Query() query: ChildrenDemographicsQueryDto,
  ) {
    return this.analyticsService.getChildrenDemographics(user, query);
  }

  @Get('district-risk')
  @Roles(UserRole.ncda_admin, UserRole.district_focal_person)
  @ApiOperation({
    summary: 'District risk snapshot',
    description:
      'Authoritative district-grain operational snapshot for NCDA situational awareness. ' +
      'One row per in-scope district with SQL aggregates (attendance, nutrition, STED, referrals). ' +
      'Does not use alert roster endpoints.',
  })
  @ApiOkResponse({ type: DistrictRiskResponseDto })
  @ApiStandardClientErrors()
  getDistrictRisk(@CurrentUser() user: AuthUser, @Query() query: DistrictRiskQueryDto) {
    return this.districtRiskService.getDistrictRisk(user, query);
  }
}
