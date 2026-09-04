import { UserRole } from '../../../common/domain';
import { Notification } from '@prisma/client';
import {
  NotificationActionDto,
  NotificationContextDto,
  NotificationResponseDto,
} from '../dto/notification-response.dto';
import { mapNotificationAction } from './notification-action.mapper';
import { resolveNotificationPriority } from '../notification-priority';

export type NotificationMapperExtras = {
  role?: UserRole;
  context?: NotificationContextDto;
  nutritionStatus?: string | null;
  childId?: string | null;
  centerId?: string | null;
  assessmentId?: string | null;
};

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function metadataPriority(metadata: Record<string, unknown> | null): string | null {
  const value = metadata?.priority;
  return typeof value === 'string' ? value : null;
}

export const notificationMapper = {
  toDto(entity: Notification, extras: NotificationMapperExtras = {}): NotificationResponseDto {
    const metadata = metadataRecord(entity.metadata);
    const context = extras.context ?? {};
    const childId = extras.childId ?? context.child?.id ?? null;
    const centerId = extras.centerId ?? context.center?.id ?? null;
    const action: NotificationActionDto | null = mapNotificationAction({
      type: entity.type,
      entityType: entity.entityType,
      entityId: entity.entityId,
      childId,
      centerId,
      assessmentId: extras.assessmentId ?? null,
      role: extras.role,
    });

    return {
      id: entity.id,
      type: entity.type,
      title: entity.title,
      message: entity.message,
      priority: resolveNotificationPriority({
        type: entity.type,
        entityType: entity.entityType,
        nutritionStatus: extras.nutritionStatus ?? null,
        metadataPriority: metadataPriority(metadata),
      }),
      isRead: entity.isRead,
      readAt: entity.readAt?.toISOString() ?? null,
      entityType: entity.entityType,
      entityId: entity.entityId,
      entity:
        entity.entityType && entity.entityId
          ? { type: entity.entityType, id: entity.entityId }
          : null,
      context,
      action,
      metadata,
      createdAt: entity.createdAt.toISOString(),
    };
  },
};
