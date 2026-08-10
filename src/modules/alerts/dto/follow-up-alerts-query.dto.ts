import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const FOLLOW_UP_CATEGORIES = [
  'all',
  'nutrition',
  'attendance',
  'referral',
  'data_quality',
] as const;

export type FollowUpCategory = (typeof FOLLOW_UP_CATEGORIES)[number];

export class FollowUpAlertsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({
    enum: FOLLOW_UP_CATEGORIES,
    enumName: 'FollowUpCategory',
    default: 'all',
  })
  @IsOptional()
  @IsIn(FOLLOW_UP_CATEGORIES)
  category?: FollowUpCategory = 'all';

  @ApiPropertyOptional({ example: 100, minimum: 1, maximum: 200, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 100;
}
