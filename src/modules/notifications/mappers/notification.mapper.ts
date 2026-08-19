import { Notification } from '@prisma/client';
import { NotificationResponseDto } from '../dto/notification-response.dto';

export const notificationMapper = {
  toDto(entity: Notification): NotificationResponseDto {
    return {
      id: entity.id,
      type: entity.type,
      title: entity.title,
      message: entity.message,
      isRead: entity.isRead,
      readAt: entity.readAt?.toISOString() ?? null,
      entityType: entity.entityType,
      entityId: entity.entityId,
      metadata: entity.metadata as Record<string, unknown> | null,
      createdAt: entity.createdAt.toISOString(),
    };
  },
};
