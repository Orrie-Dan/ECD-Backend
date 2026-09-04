import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { FOLLOW_UP_CATEGORIES, type FollowUpCategory } from './follow-up-alerts-query.dto';

export const FOLLOW_UP_SUMMARY_GROUP_BY = [
  'province',
  'district',
  'sector',
  'center',
] as const;

export type FollowUpSummaryGroupBy = (typeof FOLLOW_UP_SUMMARY_GROUP_BY)[number];

export const FOLLOW_UP_PRIORITIES = ['all', 'high', 'medium', 'low'] as const;
export type FollowUpPriorityFilter = (typeof FOLLOW_UP_PRIORITIES)[number];

export class FollowUpSummaryQueryDto {
  @ApiProperty({
    enum: FOLLOW_UP_SUMMARY_GROUP_BY,
    enumName: 'FollowUpSummaryGroupBy',
    description: 'Administrative grain for aggregation buckets',
  })
  @IsIn(FOLLOW_UP_SUMMARY_GROUP_BY)
  groupBy!: FollowUpSummaryGroupBy;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sectorId?: string;

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

  @ApiPropertyOptional({
    enum: FOLLOW_UP_PRIORITIES,
    enumName: 'FollowUpPriorityFilter',
    default: 'all',
  })
  @IsOptional()
  @IsIn(FOLLOW_UP_PRIORITIES)
  priority?: FollowUpPriorityFilter = 'all';
}

export class FollowUpSummaryPriorityCountsDto {
  @ApiProperty({ example: 3 })
  high: number;

  @ApiProperty({ example: 5 })
  medium: number;

  @ApiProperty({ example: 2 })
  low: number;
}

export class FollowUpSummaryCategoryCountsDto {
  @ApiProperty({ example: 4 })
  nutrition: number;

  @ApiProperty({ example: 3 })
  attendance: number;

  @ApiProperty({ example: 1 })
  referral: number;

  @ApiProperty({ example: 2 })
  data_quality: number;

  @ApiProperty({ example: 0 })
  sted: number;

  @ApiProperty({ example: 0 })
  transfer: number;

  @ApiProperty({ example: 0 })
  compliance: number;

  @ApiProperty({ example: 0 })
  capacity: number;
}

export class FollowUpSummaryNodeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Gasabo' })
  name: string;

  @ApiProperty({
    enum: FOLLOW_UP_SUMMARY_GROUP_BY,
    enumName: 'FollowUpSummaryGroupBy',
  })
  level: FollowUpSummaryGroupBy;

  @ApiProperty({ example: 14 })
  total: number;

  @ApiProperty({ type: () => FollowUpSummaryPriorityCountsDto })
  priorityCounts: FollowUpSummaryPriorityCountsDto;

  @ApiProperty({ type: () => FollowUpSummaryCategoryCountsDto })
  categoryCounts: FollowUpSummaryCategoryCountsDto;

  @ApiProperty({ format: 'uuid', nullable: true })
  provinceId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  sectorId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;
}

export class FollowUpSummaryScopeDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  provinceId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  sectorId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;
}

export class FollowUpSummaryResponseDto {
  @ApiProperty({
    enum: FOLLOW_UP_SUMMARY_GROUP_BY,
    enumName: 'FollowUpSummaryGroupBy',
  })
  groupBy: FollowUpSummaryGroupBy;

  @ApiProperty({ type: () => FollowUpSummaryScopeDto })
  scope: FollowUpSummaryScopeDto;

  @ApiProperty({ type: [FollowUpSummaryNodeDto] })
  items: FollowUpSummaryNodeDto[];

  @ApiProperty({ example: 42 })
  totalAlerts: number;

  @ApiProperty({ example: 8 })
  highPriority: number;

  @ApiProperty({ example: '2026-09-04T07:00:00.000Z' })
  generatedAt: string;
}
