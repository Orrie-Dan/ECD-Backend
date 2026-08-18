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
import { AlertsService } from './alerts.service';
import { FollowUpAlertsResponseDto } from './dto/follow-up-alert.dto';
import { FollowUpAlertsQueryDto } from './dto/follow-up-alerts-query.dto';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get('follow-up')
  @ApiOperation({
    summary: 'Get follow-up alerts',
    description:
      'Computed operational alerts for nutrition, attendance, referrals, and data quality in caller scope.',
  })
  @ApiOkResponse({ type: FollowUpAlertsResponseDto })
  @ApiStandardClientErrors()
  getFollowUp(
    @CurrentUser() user: AuthUser,
    @Query() query: FollowUpAlertsQueryDto,
  ) {
    return this.alertsService.getFollowUpAlerts(user, query);
  }
}
