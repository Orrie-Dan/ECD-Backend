import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, UserAccountStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  NotificationResponseDto,
  PaginatedNotificationsResponseDto,
} from './dto/notification-response.dto';
import { notificationMapper } from './mappers/notification.mapper';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    user: AuthUser,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationWhereInput = { userId: user.id };
    if (query.type) {
      where.type = query.type as NotificationType;
    }
    if (query.isRead !== undefined) {
      where.isRead = query.isRead;
    }

    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId: user.id, isRead: false },
      }),
    ]);

    return {
      items: rows.map((r) => notificationMapper.toDto(r)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      unreadCount,
    };
  }

  async getUnreadCount(user: AuthUser): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });
    return { unreadCount };
  }

  async markAsRead(user: AuthUser, id: string): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId: user.id },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.isRead) {
      return notificationMapper.toDto(notification);
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });

    return notificationMapper.toDto(updated);
  }

  async markAllAsRead(user: AuthUser): Promise<{ markedCount: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { markedCount: result.count };
  }

  async create(dto: CreateNotificationDto): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type as NotificationType,
        title: dto.title,
        message: dto.message,
        entityType: dto.entityType ?? null,
        entityId: dto.entityId ?? null,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });

    return notificationMapper.toDto(notification);
  }

  async createForMultipleUsers(
    userIds: string[],
    data: Omit<CreateNotificationDto, 'userId'>,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    const result = await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: data.type as NotificationType,
        title: data.title,
        message: data.message,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      })),
    });
    return result.count;
  }

  async findUserIdsByRoleAndCenter(centerId: string, roles: UserRole[]): Promise<string[]> {
    const users = await this.prisma.userAccount.findMany({
      where: {
        centerId,
        role: { in: roles },
        status: UserAccountStatus.active,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  async findUserIdsByRoleAndDistrict(districtId: string, roles: UserRole[]): Promise<string[]> {
    const users = await this.prisma.userAccount.findMany({
      where: {
        districtId,
        role: { in: roles },
        status: UserAccountStatus.active,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /**
   * Fire-and-forget: sends notifications without blocking the caller.
   * Logs errors instead of throwing.
   */
  notifyAsync(userIds: string[], data: Omit<CreateNotificationDto, 'userId'>): void {
    if (userIds.length === 0) return;
    this.createForMultipleUsers(userIds, data).catch((err) => {
      this.logger.error(`Failed to send ${data.type} notification: ${err.message}`, err.stack);
    });
  }
}
