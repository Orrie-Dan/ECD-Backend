import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiNotFoundError, ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  NotificationResponseDto,
  PaginatedNotificationsResponseDto,
} from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications',
    description: 'Returns paginated notifications for the authenticated user, with unread count.',
  })
  @ApiOkResponse({ type: PaginatedNotificationsResponseDto })
  @ApiStandardClientErrors()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.findAll(user, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Returns the count of unread notifications for the bell badge.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { unreadCount: { type: 'number' } },
    },
  })
  @ApiStandardClientErrors()
  getUnreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.getUnreadCount(user);
  }

  @Post(':id/read')
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Marks a single notification as read.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiNotFoundError('Notification')
  @ApiStandardClientErrors()
  markAsRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markAsRead(user, id);
  }

  @Post('read-all')
  @ApiOperation({
    summary: 'Mark all notifications as read',
    description: 'Marks all unread notifications for the user as read.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { markedCount: { type: 'number' } },
    },
  })
  @ApiStandardClientErrors()
  markAllAsRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllAsRead(user);
  }
}
