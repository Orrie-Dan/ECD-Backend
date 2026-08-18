import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
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
import { ListPaginationQueryDto } from '../../common/dto/list-pagination-query.dto';
import {
  ApiDeviceIdHeader,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  FeedingDayResponseDto,
  FeedingMonthSummaryResponseDto,
  PaginatedFeedingDaysResponseDto,
  PaginatedFeedingMonthSummariesResponseDto,
} from './dto/feeding-response.dto';
import { UpsertFeedingDayDto } from './dto/upsert-feeding-day.dto';
import { UpsertFeedingMonthSummaryDto } from './dto/upsert-feeding-month-summary.dto';
import { FeedingService } from './feeding.service';

@ApiTags('feeding')
@ApiBearerAuth()
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
@Controller()
export class FeedingController {
  constructor(private readonly feedingService: FeedingService) {}

  @Post('feeding/daily')
  @ApiOperation({
    summary: 'Upsert daily feeding record',
    description:
      'Creates or updates a center feeding day. Send version when updating an existing center+date row.',
  })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: FeedingDayResponseDto })
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  upsertDaily(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertFeedingDayDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.feedingService.upsertDaily(user, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get('centers/:centerId/feeding')
  @ApiOperation({
    summary: 'List daily feeding records',
    description: 'Paginated feeding days for a center.',
  })
  @ApiParam({ name: 'centerId', format: 'uuid' })
  @ApiOkResponse({ type: PaginatedFeedingDaysResponseDto })
  @ApiNotFoundError('Center')
  @ApiStandardClientErrors()
  listDaily(
    @CurrentUser() user: AuthUser,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Query() query: ListPaginationQueryDto,
  ) {
    return this.feedingService.listDaily(user, centerId, query);
  }

  @Post('feeding/month-summary')
  @ApiOperation({
    summary: 'Upsert monthly feeding summary',
    description:
      'Creates or updates a center feeding month summary. Send version when updating an existing center+yearMonth row.',
  })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: FeedingMonthSummaryResponseDto })
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  upsertMonthSummary(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertFeedingMonthSummaryDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.feedingService.upsertMonthSummary(user, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get('centers/:centerId/feeding/month-summary')
  @ApiOperation({
    summary: 'List monthly feeding summaries',
    description: 'Paginated feeding month summaries for a center.',
  })
  @ApiParam({ name: 'centerId', format: 'uuid' })
  @ApiOkResponse({ type: PaginatedFeedingMonthSummariesResponseDto })
  @ApiNotFoundError('Center')
  @ApiStandardClientErrors()
  listMonthSummaries(
    @CurrentUser() user: AuthUser,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Query() query: ListPaginationQueryDto,
  ) {
    return this.feedingService.listMonthSummaries(user, centerId, query);
  }
}
