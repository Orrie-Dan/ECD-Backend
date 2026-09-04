import { UserAccountStatus, UserRole } from '../../common/domain';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, Notification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  NotificationResponseDto,
  PaginatedNotificationsResponseDto,
} from './dto/notification-response.dto';
import { notificationMapper } from './mappers/notification.mapper';
import { loadNotificationInboxExtras } from './notification-inbox.context';

export type CreateNotificationData = Omit<CreateNotificationDto, 'userId'>;

export type CreateNotificationResult = {
  notification: NotificationResponseDto;
  created: boolean;
};

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

    const where: Prisma.NotificationWhereInput = { userId: user.id };
    if (query.type) {
      where.type = query.type as NotificationType;
    }
    if (query.isRead !== undefined) {
      where.isRead = query.isRead;
    }

    if (!query.priority) {
      const skip = (page - 1) * pageSize;
      const [rows, total, unreadCount] = await this.prisma.$transaction([
        this.prisma.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take: pageSize,
        }),
        this.prisma.notification.count({ where }),
        this.prisma.notification.count({
          where: { userId: user.id, isRead: false },
        }),
      ]);

      const extrasById = await loadNotificationInboxExtras(this.prisma, rows);

      return {
        items: rows.map((r) =>
          notificationMapper.toDto(r, { role: user.role, ...(extrasById.get(r.id) ?? {}) }),
        ),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize) || 1,
        unreadCount,
      };
    }

    // Priority is derived at read time — filter post-query with over-fetching.
    // Personal inboxes are bounded; this is acceptable at expected scale.
    const allRows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2000,
    });

    const extrasById = await loadNotificationInboxExtras(this.prisma, allRows);
    const mapped = allRows.map((r) => ({
      row: r,
      dto: notificationMapper.toDto(r, { role: user.role, ...(extrasById.get(r.id) ?? {}) }),
    }));
    const filtered = mapped.filter((m) => m.dto.priority === query.priority);

    const total = filtered.length;
    const skip = (page - 1) * pageSize;
    const pageItems = filtered.slice(skip, skip + pageSize);

    const unreadCount = await this.prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });

    return {
      items: pageItems.map((m) => m.dto),
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
      return this.toInboxDto(notification, user.role);
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });

    return this.toInboxDto(updated, user.role);
  }

  async markAllAsRead(user: AuthUser): Promise<{ markedCount: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { markedCount: result.count };
  }

  async create(dto: CreateNotificationDto): Promise<CreateNotificationResult> {
    try {
      const notification = await this.prisma.notification.create({
        data: this.toCreateData(dto.userId, dto),
      });
      return { notification: notificationMapper.toDto(notification), created: true };
    } catch (error) {
      if (this.isDedupeConflict(error) && dto.dedupeKey) {
        const existing = await this.prisma.notification.findFirst({
          where: { userId: dto.userId, dedupeKey: dto.dedupeKey },
        });
        if (existing) {
          this.logger.debug(
            `Notification already exists for user ${dto.userId} (${dto.type}, dedupe=${dto.dedupeKey})`,
          );
          return { notification: notificationMapper.toDto(existing), created: false };
        }
      }
      throw error;
    }
  }

  async createForMultipleUsers(userIds: string[], data: CreateNotificationData): Promise<number> {
    if (userIds.length === 0) return 0;

    if (data.dedupeKey) {
      const result = await this.prisma.notification.createMany({
        data: userIds.map((userId) => this.toCreateData(userId, data)),
        skipDuplicates: true,
      });
      if (result.count < userIds.length) {
        this.logger.debug(
          `Skipped ${userIds.length - result.count} duplicate ${data.type} notification(s) (dedupe=${data.dedupeKey})`,
        );
      }
      return result.count;
    }

    const result = await this.prisma.notification.createMany({
      data: userIds.map((userId) => this.toCreateData(userId, data)),
    });
    return result.count;
  }

  async findUserIdsByRole(roles: UserRole[]): Promise<string[]> {
    const users = await this.prisma.userAccount.findMany({
      where: {
        role: { in: roles },
        status: UserAccountStatus.active,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
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
   * Logs errors instead of throwing. Dedupe collisions are handled at persistence layer.
   */
  notifyAsync(userIds: string[], data: CreateNotificationData, logContext?: string): void {
    if (userIds.length === 0) {
      if (logContext) {
        this.logger.warn(`No notification recipients for ${logContext} (${data.type})`);
      }
      return;
    }
    this.createForMultipleUsers(userIds, data).catch((err) => {
      if (this.isDedupeConflict(err)) {
        this.logger.debug(
          `Duplicate notification suppressed${logContext ? ` (${logContext})` : ''}: ${data.type}`,
        );
        return;
      }
      const suffix = logContext ? ` (${logContext})` : '';
      this.logger.error(
        `Failed to send ${data.type} notification${suffix}: ${err.message}`,
        err.stack,
      );
    });
  }

  private toCreateData(
    userId: string,
    data: CreateNotificationData,
  ): Prisma.NotificationCreateManyInput {
    return {
      userId,
      type: data.type as NotificationType,
      title: data.title,
      message: data.message,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      dedupeKey: data.dedupeKey ?? null,
      metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    };
  }

  private isDedupeConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private async toInboxDto(notification: Notification, role: UserRole) {
    const extrasById = await loadNotificationInboxExtras(this.prisma, [notification]);
    return notificationMapper.toDto(notification, {
      role,
      ...(extrasById.get(notification.id) ?? {}),
    });
  }
}
