import { ApiProperty } from '@nestjs/swagger';

/** One sector or center — same indicator semantics as DistrictRiskItemDto. */
export class AreaIndicatorItemDto {
  @ApiProperty({ format: 'uuid', description: 'Sector (administrative unit) id or ECD center id' })
  areaId: string;

  @ApiProperty({ example: 'Kimironko' })
  areaName: string;

  @ApiProperty({ example: '110204', description: 'Sector code or ECD center code' })
  areaCode: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ example: 'Gasabo', nullable: true })
  districtName: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Center level only; null for sectors or unmapped centers',
  })
  latitude: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Center level only; null for sectors or unmapped centers',
  })
  longitude: number | null;

  @ApiProperty({ example: 120, description: 'Active enrolled children' })
  activeChildren: number;

  @ApiProperty({
    example: 87.5,
    nullable: true,
    description:
      'Present / (present + absent) attendance records in range (%). Null when no records.',
  })
  attendanceRate: number | null;

  @ApiProperty({ example: 320, description: 'Present + absent attendance records in range' })
  attendanceRecords: number;

  @ApiProperty({
    example: 1,
    description: 'Screenings in range with any WHO indicator below_minus_3 (same as district-risk)',
  })
  severeNutritionCount: number;

  @ApiProperty({ example: 48, description: 'All nutrition screenings in range' })
  nutritionScreenings: number;

  @ApiProperty({ example: 2, description: 'Open referrals (status=pending, not range-limited)' })
  pendingReferralCount: number;

  @ApiProperty({ example: 35, description: 'Distinct children with STED assessments in range' })
  stedChildrenAssessed: number;

  @ApiProperty({
    example: 35.0,
    nullable: true,
    description:
      'Distinct children assessed / active children × 100. Null when no active children.',
  })
  stedCoverage: number | null;

  @ApiProperty({
    example: 72.4,
    nullable: true,
    description:
      'Mean overall % of each center’s latest submitted/verified self-evaluation (same as district-risk). Null when no center has one.',
  })
  selfEvalPercent: number | null;

  @ApiProperty({
    example: 3,
    description: 'Centers whose latest self-evaluation has an overall %',
  })
  selfEvalCentersEvaluated: number;
}

export class AreaIndicatorsResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-31T00:00:00.000Z' })
  to: string;

  @ApiProperty({ enum: ['sector', 'center'] })
  level: 'sector' | 'center';

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  sectorId: string | null;

  @ApiProperty({ type: () => AreaIndicatorItemDto, isArray: true })
  items: AreaIndicatorItemDto[];

  @ApiProperty({ example: 416 })
  total: number;
}
