import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ApiNotificationType =
  | 'transfer_request'
  | 'transfer_accepted'
  | 'transfer_cancelled'
  | 'child_enrolled'
  | 'child_archived'
  | 'assessment_due' // legacy: no active producer, retained for historical row compatibility
  | 'referral_created'
  | 'referral_updated'
  | 'nutrition_alert'
  | 'sted_followup'
  | 'compliance_update'
  | 'capacity_warning'
  | 'attendance_absence'
  | 'attendance_low_rate'
  | 'center_created'
  | 'general';

export type ApiNotificationPriority = 'low' | 'medium' | 'high' | 'critical';

export class NotificationEntityRefDto {
  @ApiProperty()
  type: string;

  @ApiProperty()
  id: string;
}

export class NotificationChildContextDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class NotificationCenterContextDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class NotificationDistrictContextDto {
  @ApiPropertyOptional({ format: 'uuid' })
  id?: string;

  @ApiPropertyOptional()
  name?: string;
}

export class NotificationContextDto {
  @ApiPropertyOptional({ type: NotificationChildContextDto })
  child?: NotificationChildContextDto;

  @ApiPropertyOptional({ type: NotificationCenterContextDto })
  center?: NotificationCenterContextDto;

  @ApiPropertyOptional({ type: NotificationDistrictContextDto })
  district?: NotificationDistrictContextDto;
}

export class NotificationActionDto {
  @ApiProperty({ enum: ['route'] })
  type: 'route';

  @ApiProperty({ example: '/children/uuid' })
  path: string;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  type: ApiNotificationType;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ enum: ['low', 'medium', 'high', 'critical'] })
  priority: ApiNotificationPriority;

  @ApiProperty()
  isRead: boolean;

  @ApiPropertyOptional()
  readAt: string | null;

  @ApiPropertyOptional()
  entityType: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  entityId: string | null;

  @ApiPropertyOptional({ type: NotificationEntityRefDto, nullable: true })
  entity: NotificationEntityRefDto | null;

  @ApiProperty({ type: NotificationContextDto })
  context: NotificationContextDto;

  @ApiPropertyOptional({ type: NotificationActionDto, nullable: true })
  action: NotificationActionDto | null;

  @ApiPropertyOptional({ type: Object })
  metadata: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: string;
}

export class PaginatedNotificationsResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items: NotificationResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;

  @ApiProperty()
  unreadCount: number;
}

export class UnreadCountResponseDto {
  @ApiProperty()
  unreadCount: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty()
  markedCount: number;
}
