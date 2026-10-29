import { UserRole } from '../../common/domain';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { AnalyticsService } from './analytics.service';
import { AreaIndicatorsService } from './area-indicators.service';
import { ChildrenConditionsService } from './children-conditions.service';
import { DistrictRiskService } from './district-risk.service';
import { AreaIndicatorsQueryDto } from './dto/area-indicators-query.dto';
import { AreaIndicatorsResponseDto } from './dto/area-indicators-response.dto';
import { ChildrenConditionsQueryDto } from './dto/children-conditions-query.dto';
import { ChildrenConditionsResponseDto } from './dto/children-conditions-response.dto';
import { ChildrenDemographicsQueryDto } from './dto/children-demographics-query.dto';
import { ChildrenDemographicsResponseDto } from './dto/children-demographics-response.dto';
import { ChildrenDistributionQueryDto } from './dto/children-distribution-query.dto';
import { ChildrenDistributionResponseDto } from './dto/children-distribution-response.dto';
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
  UserRole.sector_focal_person,
  UserRole.ncda_admin,
)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly districtRiskService: DistrictRiskService,
    private readonly childrenConditionsService: ChildrenConditionsService,
    private readonly areaIndicatorsService: AreaIndicatorsService,
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

  @Get('children-distribution')
  @ApiOperation({
    summary: 'Children per administrative area (province down to ECD center)',
    description:
      'Active children boys/girls/total per area at the requested `level` ' +
      '(province, district, sector, cell, village or center), most children first. ' +
      'Uses the same geographic scope as /analytics/children-demographics. Aggregate-only.',
  })
  @ApiOkResponse({ type: ChildrenDistributionResponseDto })
  @ApiStandardClientErrors()
  getChildrenDistribution(
    @CurrentUser() user: AuthUser,
    @Query() query: ChildrenDistributionQueryDto,
  ) {
    return this.analyticsService.getChildrenDistribution(user, query);
  }

  @Get('children-conditions')
  @Roles(UserRole.ncda_admin, UserRole.district_focal_person)
  @ApiOperation({
    summary: 'Children by condition per district or sector',
    description:
      'Per-area counts and rates for stunting, underweight, low MUAC, any malnutrition (WHO < −2 SD, ' +
      'latest measurement in range), disability, and not screened in range. Children are attributed ' +
      'to the area of their ECD center. Aggregate-only; affected counts and rates are withheld ' +
      'below `minDenominator`. `level=sector` requires a district.',
  })
  @ApiOkResponse({ type: ChildrenConditionsResponseDto })
  @ApiStandardClientErrors()
  getChildrenConditions(@CurrentUser() user: AuthUser, @Query() query: ChildrenConditionsQueryDto) {
    return this.childrenConditionsService.getChildrenConditions(user, query);
  }

  @Get('district-risk')
  @Roles(UserRole.ncda_admin, UserRole.district_focal_person, UserRole.sector_focal_person)
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

  @Get('area-indicators')
  @Roles(UserRole.ncda_admin, UserRole.district_focal_person)
  @ApiOperation({
    summary: 'Monitoring indicators per sector or ECD center',
    description:
      'District-risk indicators (attendance, severe nutrition, open referrals, STED coverage) ' +
      'below district grain, attributed to the area of each ECD center. `level=center` adds ' +
      'center coordinates; `sectorId` narrows to the centers of one sector. Only areas with at ' +
      'least one center in scope are returned.',
  })
  @ApiOkResponse({ type: AreaIndicatorsResponseDto })
  @ApiStandardClientErrors()
  getAreaIndicators(@CurrentUser() user: AuthUser, @Query() query: AreaIndicatorsQueryDto) {
    return this.areaIndicatorsService.getAreaIndicators(user, query);
  }
}
