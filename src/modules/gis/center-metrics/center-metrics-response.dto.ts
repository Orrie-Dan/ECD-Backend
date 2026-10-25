import { ApiProperty } from '@nestjs/swagger';

export class CenterMetricsItemDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'ECD-0001' })
  code: string;

  @ApiProperty({ example: 'APPEK Kamuhoza' })
  name: string;

  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty({ example: -1.9441 })
  latitude: number;

  @ApiProperty({ example: 30.0619 })
  longitude: number;

  @ApiProperty({ example: 42, description: 'Active (non-deleted) children currently enrolled' })
  enrolledChildren: number;

  @ApiProperty({
    example: 87.5,
    nullable: true,
    description: 'Present / (present + absent) in range, percent; null when no records',
  })
  attendanceRate: number | null;

  @ApiProperty({ example: 640, description: 'Attendance records (present + absent) in range' })
  attendanceRecords: number;

  @ApiProperty({
    example: 84,
    nullable: true,
    description: 'Latest submitted/verified self-assessment overall percent (any date)',
  })
  selfEvalPercent: number | null;

  @ApiProperty({ example: 'blue', nullable: true, description: 'green | blue | yellow | red' })
  selfEvalRank: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  selfEvalDate: string | null;

  @ApiProperty({
    example: 22.5,
    nullable: true,
    description:
      'Share of screened children whose latest height-for-age in range is below −2 SD, percent. ' +
      'Null when fewer than `stuntingMinScreened` children were classifiable.',
  })
  stuntingRate: number | null;

  @ApiProperty({
    example: 40,
    description: 'Children with a classifiable height-for-age measurement in range',
  })
  stuntingScreened: number;
}

export class CenterMetricsResponseDto {
  @ApiProperty({ example: '2026-07-25T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-10-23T00:00:00.000Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  sectorId: string | null;

  @ApiProperty({
    example: 10,
    description: 'Minimum screened children before a stunting rate is shown',
  })
  stuntingMinScreened: number;

  @ApiProperty({ type: [CenterMetricsItemDto], description: 'Centers with usable coordinates' })
  items: CenterMetricsItemDto[];

  @ApiProperty({ example: 3, description: 'Centers in scope without usable coordinates' })
  unmappedCount: number;
}
