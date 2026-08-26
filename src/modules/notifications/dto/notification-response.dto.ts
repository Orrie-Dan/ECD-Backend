import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ApiNotificationType =
  | 'transfer_request'
  | 'transfer_accepted'
  | 'transfer_cancelled'
  | 'child_enrolled'
  | 'child_archived'
  | 'assessment_due'
  | 'referral_created'
  | 'referral_updated'
  | 'nutrition_alert'
  | 'sted_followup'
  | 'compliance_update'
  | 'capacity_warning'
  | 'attendance_absence'
  | 'attendance_low_rate'
  | 'general';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  type: ApiNotificationType;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  isRead: boolean;

  @ApiPropertyOptional()
  readAt: string | null;

  @ApiPropertyOptional()
  entityType: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  entityId: string | null;

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
