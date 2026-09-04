import { UserRole } from '../../common/domain';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { MonitoringQueryDto } from './dto/monitoring-query.dto';
import {
  MonitoringAttendanceResponseDto,
  MonitoringFeedingResponseDto,
  MonitoringNutritionResponseDto,
  MonitoringReferralsResponseDto,
  MonitoringStedResponseDto,
  MonitoringComplianceResponseDto,
  MonitoringWashResponseDto,
} from './dto/monitoring-response.dto';
import { MonitoringService } from './monitoring.service';

@ApiTags('monitoring')
@ApiBearerAuth()
@Controller('monitoring')
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('attendance')
  @ApiOperation({
    summary: 'Monitor attendance',
    description:
      'Attendance summary, daily trend, and per-center breakdown for the selected scope/date range.',
  })
  @ApiOkResponse({ type: MonitoringAttendanceResponseDto })
  @ApiStandardClientErrors()
  attendance(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.monitoring.attendance(user, query);
  }

  @Get('nutrition')
  @ApiOperation({
    summary: 'Monitor nutrition',
    description: 'Nutrition screening coverage and severity breakdown by center.',
  })
  @ApiOkResponse({ type: MonitoringNutritionResponseDto })
  @ApiStandardClientErrors()
  nutrition(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.monitoring.nutrition(user, query);
  }

  @Get('feeding')
  @ApiOperation({
    summary: 'Monitor feeding',
    description:
      'Center feeding-day coverage (milk/porridge/balanced meal) for the selected range.',
  })
  @ApiOkResponse({ type: MonitoringFeedingResponseDto })
  @ApiStandardClientErrors()
  feeding(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.monitoring.feeding(user, query);
  }

  @Get('sted')
  @ApiOperation({
    summary: 'Monitor STED',
    description: 'STED assessment coverage, average scores, and age-band/outcome distributions.',
  })
  @ApiOkResponse({ type: MonitoringStedResponseDto })
  @ApiStandardClientErrors()
  sted(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.monitoring.sted(user, query);
  }

  @Get('compliance')
  @ApiOperation({
    summary: 'Monitor compliance aggregates',
    description:
      'National/district compliance assessment counts and status breakdown — SQL aggregates only.',
  })
  @ApiOkResponse({ type: MonitoringComplianceResponseDto })
  @ApiStandardClientErrors()
  compliance(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.monitoring.compliance(user, query);
  }

  @Get('wash')
  @ApiOperation({
    summary: 'Monitor WASH aggregates',
    description:
      'WASH reporting volume and latest-snapshot facility counts for the selected scope.',
  })
  @ApiOkResponse({ type: MonitoringWashResponseDto })
  @ApiStandardClientErrors()
  wash(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.monitoring.wash(user, query);
  }

  @Get('referrals')
  @ApiOperation({
    summary: 'Monitor referrals',
    description: 'Referral pipeline metrics (pending/completed/overdue) with per-center items.',
  })
  @ApiOkResponse({ type: MonitoringReferralsResponseDto })
  @ApiStandardClientErrors()
  referrals(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.monitoring.referrals(user, query);
  }
}
