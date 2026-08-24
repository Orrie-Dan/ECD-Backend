import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { MonitoringQueryDto } from '../monitoring/dto/monitoring-query.dto';
import {
  CentersReportResponseDto,
  DistrictReportResponseDto,
  DropoutsReportResponseDto,
  EnrollmentReportResponseDto,
} from './dto/report-response.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@Roles(UserRole.district_focal_person, UserRole.ncda_admin)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('enrollment')
  @ApiOperation({
    summary: 'Enrollment report',
    description:
      'Enrollment totals by status plus new-registration trend for the selected scope/date range.',
  })
  @ApiOkResponse({ type: EnrollmentReportResponseDto })
  @ApiStandardClientErrors()
  enrollment(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.reports.enrollment(user, query);
  }

  @Get('dropouts')
  @ApiOperation({
    summary: 'Dropouts report',
    description:
      'Archived children in range (interpreted as dropouts) plus transfers-out count. Includes lifecycle interpretation notes.',
  })
  @ApiOkResponse({ type: DropoutsReportResponseDto })
  @ApiStandardClientErrors()
  dropouts(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.reports.dropouts(user, query);
  }

  @Get('centers')
  @ApiOperation({
    summary: 'Centers performance report',
    description:
      'Per-center snapshot of enrollment, attendance, nutrition, feeding, referrals, and STED for the date range.',
  })
  @ApiOkResponse({ type: CentersReportResponseDto })
  @ApiStandardClientErrors()
  centers(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.reports.centers(user, query);
  }

  @Get('district')
  @ApiOperation({
    summary: 'District KPI report',
    description:
      'District-level KPI rollup (children, attendance rate, nutrition, referrals, feeding, STED).',
  })
  @ApiOkResponse({ type: DistrictReportResponseDto })
  @ApiStandardClientErrors()
  district(@CurrentUser() user: AuthUser, @Query() query: MonitoringQueryDto) {
    return this.reports.district(user, query);
  }
}
