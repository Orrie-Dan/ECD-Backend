import { ApiProperty } from '@nestjs/swagger';

export type FollowUpAlertCategory =
  | 'nutrition'
  | 'attendance'
  | 'referral'
  | 'data_quality';

export type FollowUpAlertPriority = 'high' | 'medium' | 'low';

export class FollowUpAlertMetricDto {
  @ApiProperty({ example: 'MUAC (cm)' })
  label: string;

  @ApiProperty({ example: '11.2' })
  value: string;
}

export class FollowUpAlertDto {
  @ApiProperty({ example: 'nutrition:child-uuid' })
  id: string;

  @ApiProperty({
    enum: ['nutrition', 'attendance', 'referral', 'data_quality'],
    enumName: 'FollowUpAlertCategory',
  })
  category: FollowUpAlertCategory;

  @ApiProperty({
    enum: ['high', 'medium', 'low'],
    enumName: 'FollowUpAlertPriority',
  })
  priority: FollowUpAlertPriority;

  @ApiProperty({ example: 'NUTRITION_SEVERE' })
  code: string;

  @ApiProperty({ example: 'Severe malnutrition detected' })
  title: string;

  @ApiProperty({ example: 'Child requires urgent referral' })
  description: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ example: 'Kigali ECD Center', nullable: true })
  centerName: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  childId: string | null;

  @ApiProperty({ example: 'Jane Doe', nullable: true })
  childName: string | null;

  @ApiProperty({ example: 'ChildNutritionScreening', nullable: true })
  entityType: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  entityId: string | null;

  @ApiProperty({
    example: '2026-08-06T12:00:00.000Z',
    description: 'ISO-8601 detection timestamp',
  })
  detectedAt: string;

  @ApiProperty({ type: [FollowUpAlertMetricDto] })
  metrics: FollowUpAlertMetricDto[];
}

export class FollowUpAlertCountsDto {
  @ApiProperty({ example: 3 })
  nutrition: number;

  @ApiProperty({ example: 2 })
  attendance: number;

  @ApiProperty({ example: 1 })
  referral: number;

  @ApiProperty({ example: 0 })
  data_quality: number;

  @ApiProperty({ example: 4 })
  high: number;
}

export class FollowUpAlertsResponseDto {
  @ApiProperty({ type: [FollowUpAlertDto] })
  items: FollowUpAlertDto[];

  @ApiProperty({ example: 6 })
  total: number;

  @ApiProperty({ type: () => FollowUpAlertCountsDto })
  counts: FollowUpAlertCountsDto;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;
}
