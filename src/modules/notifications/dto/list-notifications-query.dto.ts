import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const NOTIFICATION_TYPES = [
  'transfer_request',
  'transfer_accepted',
  'transfer_cancelled',
  'child_enrolled',
  'child_archived',
  'referral_created',
  'referral_updated',
  'nutrition_alert',
  'sted_followup',
  'compliance_update',
  'capacity_warning',
  'attendance_absence',
  'attendance_low_rate',
  'center_created',
  'general',
] as const;

const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: (typeof NOTIFICATION_TYPES)[number];

  @ApiPropertyOptional({ description: 'Filter by read status' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({
    enum: NOTIFICATION_PRIORITIES,
    description: 'Filter by derived priority level',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_PRIORITIES)
  priority?: (typeof NOTIFICATION_PRIORITIES)[number];
}
