import { ApiProperty } from '@nestjs/swagger';

export class DistrictRiskItemDto {
  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ example: 'Gasabo' })
  districtName: string;

  @ApiProperty({ example: 'GAS' })
  districtCode: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({
    example: 1250,
    description: 'Active enrolled children (Child.status=active, not deleted)',
  })
  activeChildren: number;

  @ApiProperty({
    example: 42,
    description: 'Non-deleted ECD centers in the district',
  })
  centersInScope: number;

  @ApiProperty({
    example: 87.5,
    nullable: true,
    description:
      'Present / (present + absent) attendance records in range (%). Null when no records.',
  })
  attendanceRate: number | null;

  @ApiProperty({
    example: 3200,
    description: 'Present + absent attendance records in the selected period',
  })
  attendanceRecords: number;

  @ApiProperty({
    example: 3,
    description:
      'Nutrition screenings with nutritionStatus=severe in range (same as reports/district severeNutrition)',
  })
  severeNutritionCount: number;

  @ApiProperty({
    example: 48,
    description: 'All nutrition screenings in range',
  })
  nutritionScreenings: number;

  @ApiProperty({
    example: 2,
    description:
      'Open referral pipeline count (Referral.status=pending, not range-limited — matches reports/district)',
  })
  pendingReferralCount: number;

  @ApiProperty({ example: 40 })
  stedAssessmentsCompleted: number;

  @ApiProperty({
    example: 35,
    description: 'Distinct children with STED assessments in range',
  })
  stedChildrenAssessed: number;

  @ApiProperty({
    example: 35.0,
    nullable: true,
    description:
      'Distinct children assessed / active children × 100 (Monitoring STED coverage semantics). Null when no active children.',
  })
  stedCoverage: number | null;

  @ApiProperty({
    example: 5,
    description: 'STED assessments flagged for 6-month follow-up due on or before range end',
  })
  stedPendingFollowUps: number;

  @ApiProperty({
    enum: ['normal', 'watch', 'concern', 'critical'],
  })
  severity: 'normal' | 'watch' | 'concern' | 'critical';

  @ApiProperty({
    nullable: true,
    description: 'Reserved — null in Phase 1 (no approved weighting model)',
    example: null,
  })
  riskScore: number | null;

  @ApiProperty({
    enum: [
      'district_inactive',
      'sted_coverage_low',
      'attendance_low',
      'severe_nutrition_elevated',
      'referral_backlog',
      'insufficient_data',
      'none',
    ],
  })
  primaryIssueCode:
    | 'district_inactive'
    | 'sted_coverage_low'
    | 'attendance_low'
    | 'severe_nutrition_elevated'
    | 'referral_backlog'
    | 'insufficient_data'
    | 'none';

  @ApiProperty({
    type: [String],
    example: ['sted_concern', 'attendance_data_available'],
  })
  signalFlags: string[];

  @ApiProperty({
    enum: ['complete', 'partial', 'insufficient'],
  })
  dataQuality: 'complete' | 'partial' | 'insufficient';
}

export class DistrictRiskResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-31T00:00:00.000Z' })
  to: string;

  @ApiProperty({
    example: '2026-09-02T12:00:00.000Z',
    description: 'Server timestamp when the snapshot was computed',
  })
  generatedAt: string;

  @ApiProperty({
    example: 'district-risk-v1',
    description: 'Risk interpretation version — bump when severity rules change',
  })
  methodologyVersion: string;

  @ApiProperty({ type: () => DistrictRiskItemDto, isArray: true })
  items: DistrictRiskItemDto[];

  @ApiProperty({ example: 30 })
  total: number;
}
