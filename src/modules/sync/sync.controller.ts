import { Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiNotFoundError,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncPullQueryDto } from './dto/sync-pull-query.dto';
import { SyncPushDto } from './dto/sync-push.dto';
import {
  SyncPullResponseDto,
  SyncPushResponseDto,
  SyncSessionStatusResponseDto,
} from './dto/sync-response.dto';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @ApiOperation({
    summary: 'Push offline operations',
    description:
      'Accepts a batch of client sync operations. Deduplicates by clientOperationId and returns per-operation results.',
  })
  @ApiCreatedResponse({ type: SyncPushResponseDto })
  @ApiStandardClientErrors()
  push(@CurrentUser() user: AuthUser, @Body() dto: SyncPushDto) {
    return this.syncService.push(user, dto);
  }

  @Get('pull')
  @ApiOperation({
    summary: 'Pull entity changes',
    description:
      'Returns created/updated/deleted entity buckets since the provided cursor, with pagination via nextCursor/hasMore.',
  })
  @ApiOkResponse({ type: SyncPullResponseDto })
  @ApiStandardClientErrors()
  pull(@CurrentUser() user: AuthUser, @Query() query: SyncPullQueryDto) {
    return this.syncService.pull(user, query);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({
    summary: 'Get sync session status',
    description:
      'Returns status and per-operation results for a previously created sync push session.',
  })
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiOkResponse({ type: SyncSessionStatusResponseDto })
  @ApiNotFoundError('Sync session')
  @ApiStandardClientErrors()
  sessionStatus(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.syncService.getSessionStatus(user, sessionId);
  }
}
