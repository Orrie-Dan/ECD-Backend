import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { AnalyticsService } from './analytics.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles(
  UserRole.caregiver,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Get analytics dashboard',
    description:
      'Aggregate KPI snapshot for children, attendance, nutrition, referrals, and feeding in the selected scope/date range.',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  @ApiStandardClientErrors()
  getDashboard(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.analyticsService.getDashboard(user, query);
  }
}
