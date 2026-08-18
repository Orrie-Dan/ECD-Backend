import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  ApiDeviceIdHeader,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateReferralDto } from './dto/create-referral.dto';
import { ListReferralsQueryDto } from './dto/list-referrals-query.dto';
import {
  PaginatedReferralsResponseDto,
  ReferralHistoryResponseDto,
  ReferralResponseDto,
} from './dto/referral-response.dto';
import { UpdateReferralStatusDto } from './dto/update-referral-status.dto';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals')
@ApiBearerAuth()
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
@Controller()
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Post('referrals')
  @ApiOperation({
    summary: 'Create referral',
    description:
      'Creates a referral linked to a nutrition screening or STED assessment source.',
  })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: ReferralResponseDto })
  @ApiStandardClientErrors()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReferralDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.referralsService.create(user, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get('referrals')
  @ApiOperation({
    summary: 'List referrals',
    description: 'Paginated referrals filtered by caller scope and query params.',
  })
  @ApiOkResponse({ type: PaginatedReferralsResponseDto })
  @ApiStandardClientErrors()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: ListReferralsQueryDto,
  ) {
    return this.referralsService.findAll(user, query);
  }

  @Get('children/:id/referrals')
  @ApiOperation({
    summary: 'Get child referral history',
    description: 'Returns all referrals for a child (newest first).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child ID' })
  @ApiOkResponse({ type: ReferralHistoryResponseDto })
  @ApiNotFoundError('Child')
  @ApiStandardClientErrors()
  getChildHistory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) childId: string,
  ) {
    return this.referralsService.getChildHistory(user, childId);
  }

  @Patch('referrals/:id/status')
  @ApiOperation({
    summary: 'Update referral status',
    description:
      'Transitions a referral to completed or cancelled. Requires version for optimistic locking.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiDeviceIdHeader()
  @ApiOkResponse({ type: ReferralResponseDto })
  @ApiNotFoundError('Referral')
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReferralStatusDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.referralsService.updateStatus(user, id, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }
}
