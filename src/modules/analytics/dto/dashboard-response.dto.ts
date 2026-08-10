import { ApiProperty } from '@nestjs/swagger';

export class DashboardChildrenMetricsDto {
  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 80 })
  active: number;

  @ApiProperty({ example: 10 })
  archived: number;

  @ApiProperty({ example: 10 })
  transferred: number;
}

export class DashboardAttendanceMetricsDto {
  @ApiProperty({ example: 70 })
  present: number;

  @ApiProperty({ example: 10 })
  absent: number;

  @ApiProperty({ example: 80 })
  totalRecords: number;

  @ApiProperty({ example: 87.5, nullable: true })
  rate: number | null;

  @ApiProperty({ example: 5 })
  centersReporting: number;
}

export class DashboardNutritionMetricsDto {
  @ApiProperty({ example: 50 })
  screenings: number;

  @ApiProperty({ example: 2 })
  severe: number;

  @ApiProperty({ example: 5 })
  moderate: number;

  @ApiProperty({ example: 8 })
  atRisk: number;

  @ApiProperty({ example: 35 })
  normal: number;

  @ApiProperty({ example: 4 })
  requiresReferral: number;
}

export class DashboardReferralMetricsDto {
  @ApiProperty({ example: 12 })
  created: number;

  @ApiProperty({ example: 3 })
  pending: number;

  @ApiProperty({ example: 8 })
  completed: number;

  @ApiProperty({ example: 1 })
  cancelled: number;
}

export class DashboardFeedingMetricsDto {
  @ApiProperty({ example: 20 })
  daysRecorded: number;

  @ApiProperty({ example: 15 })
  daysWithMilk: number;

  @ApiProperty({ example: 18 })
  daysWithPorridge: number;

  @ApiProperty({ example: 12 })
  daysWithBalancedMeal: number;

  @ApiProperty({ example: 5 })
  centersReporting: number;
}

export class DashboardResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ example: 12 })
  centersInScope: number;

  @ApiProperty({ type: () => DashboardChildrenMetricsDto })
  children: DashboardChildrenMetricsDto;

  @ApiProperty({ type: () => DashboardAttendanceMetricsDto })
  attendance: DashboardAttendanceMetricsDto;

  @ApiProperty({ type: () => DashboardNutritionMetricsDto })
  nutrition: DashboardNutritionMetricsDto;

  @ApiProperty({ type: () => DashboardReferralMetricsDto })
  referrals: DashboardReferralMetricsDto;

  @ApiProperty({ type: () => DashboardFeedingMetricsDto })
  feeding: DashboardFeedingMetricsDto;
}
