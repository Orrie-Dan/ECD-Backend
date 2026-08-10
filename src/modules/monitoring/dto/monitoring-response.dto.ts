import { ApiProperty } from '@nestjs/swagger';

/** Attendance trend point (monitoring attendance). */
export class MonitoringAttendanceTrendPointDto {
  @ApiProperty({ example: '2026-08-06' })
  date: string;

  @ApiProperty({ example: 20 })
  present: number;

  @ApiProperty({ example: 5 })
  absent: number;

  @ApiProperty({ example: 80, nullable: true })
  rate: number | null;
}

export class MonitoringAttendanceSummaryDto {
  @ApiProperty({ example: 100 })
  enrolledChildren: number;

  @ApiProperty({ example: 80 })
  present: number;

  @ApiProperty({ example: 20 })
  absent: number;

  @ApiProperty({ example: 100 })
  totalRecords: number;

  @ApiProperty({ example: 80, nullable: true })
  attendanceRate: number | null;
}

export class MonitoringAttendanceCenterItemDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  centerName: string;

  @ApiProperty({ example: 40 })
  enrolledChildren: number;

  @ApiProperty({ example: 32 })
  present: number;

  @ApiProperty({ example: 8 })
  absent: number;

  @ApiProperty({ example: 80, nullable: true })
  rate: number | null;
}

export class MonitoringAttendanceResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  sectorId: string | null;

  @ApiProperty({ type: () => MonitoringAttendanceSummaryDto })
  summary: MonitoringAttendanceSummaryDto;

  @ApiProperty({ type: [MonitoringAttendanceTrendPointDto] })
  trend: MonitoringAttendanceTrendPointDto[];

  @ApiProperty({ type: [MonitoringAttendanceCenterItemDto] })
  items: MonitoringAttendanceCenterItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class MonitoringNutritionSummaryDto {
  @ApiProperty({ example: 100 })
  activeChildren: number;

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

  @ApiProperty({ example: 3 })
  overdueScreenings: number;

  @ApiProperty({ example: 10 })
  neverScreened: number;

  @ApiProperty({ example: 90, nullable: true })
  screeningCoverage: number | null;
}

export class MonitoringNutritionCenterItemDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  centerName: string;

  @ApiProperty({ example: 10 })
  screenings: number;

  @ApiProperty({ example: 1 })
  severe: number;

  @ApiProperty({ example: 2 })
  moderate: number;

  @ApiProperty({ example: 3 })
  atRisk: number;

  @ApiProperty({ example: 4 })
  normal: number;
}

export class MonitoringNutritionResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ type: () => MonitoringNutritionSummaryDto })
  summary: MonitoringNutritionSummaryDto;

  @ApiProperty({ type: [MonitoringNutritionCenterItemDto] })
  items: MonitoringNutritionCenterItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class MonitoringFeedingSummaryDto {
  @ApiProperty({ example: 20 })
  daysRecorded: number;

  @ApiProperty({ example: 15 })
  daysWithMilk: number;

  @ApiProperty({ example: 18 })
  daysWithPorridge: number;

  @ApiProperty({ example: 12 })
  daysWithBalancedMeal: number;

  @ApiProperty({ example: 5 })
  reportingCenters: number;

  @ApiProperty({ example: 8 })
  centersInScope: number;

  @ApiProperty({ example: 48 })
  expectedDayRecords: number;

  @ApiProperty({ example: 41.7, nullable: true })
  feedingCoverage: number | null;

  @ApiProperty({ example: 2 })
  centersMissingReports: number;
}

export class MonitoringFeedingCenterItemDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  centerName: string;

  @ApiProperty({ example: 5 })
  daysRecorded: number;

  @ApiProperty({ example: 6 })
  expectedDays: number;

  @ApiProperty({ example: 1 })
  missingDays: number;

  @ApiProperty({ example: 83.3, nullable: true })
  coverage: number | null;
}

export class MonitoringFeedingResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ type: () => MonitoringFeedingSummaryDto })
  summary: MonitoringFeedingSummaryDto;

  @ApiProperty({ type: [MonitoringFeedingCenterItemDto] })
  items: MonitoringFeedingCenterItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class MonitoringStedSummaryDto {
  @ApiProperty({ example: 40 })
  assessmentsCompleted: number;

  @ApiProperty({ example: 100 })
  activeChildren: number;

  @ApiProperty({ example: 40, nullable: true })
  coverage: number | null;

  @ApiProperty({ example: 72.5, nullable: true })
  averageScore: number | null;

  @ApiProperty({ example: 5 })
  pendingFollowUps: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { band_1_3: 20, band_4_6: 20 },
    description: 'Counts keyed by StedAgeBand',
  })
  ageBandDistribution: Record<string, number>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { on_track: 30, unspecified: 10 },
    description: 'Counts keyed by outcome classification',
  })
  outcomeDistribution: Record<string, number>;
}

export class MonitoringStedCenterItemDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  centerName: string;

  @ApiProperty({ example: 8 })
  assessmentsCompleted: number;

  @ApiProperty({ example: 70, nullable: true })
  averageScore: number | null;
}

export class MonitoringStedResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ type: () => MonitoringStedSummaryDto })
  summary: MonitoringStedSummaryDto;

  @ApiProperty({ type: [MonitoringStedCenterItemDto] })
  items: MonitoringStedCenterItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class MonitoringReferralsSummaryDto {
  @ApiProperty({ example: 12 })
  created: number;

  @ApiProperty({ example: 3 })
  pending: number;

  @ApiProperty({ example: 8 })
  completed: number;

  @ApiProperty({ example: 1 })
  cancelled: number;

  @ApiProperty({ example: 2 })
  overdue: number;

  @ApiProperty({ example: 4.5, nullable: true })
  averageCompletionDays: number | null;
}

export class MonitoringReferralsCenterItemDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  centerName: string;

  @ApiProperty({ example: 2 })
  pending: number;

  @ApiProperty({ example: 5 })
  completed: number;

  @ApiProperty({ example: 1 })
  overdue: number;
}

export class MonitoringReferralsResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ type: () => MonitoringReferralsSummaryDto })
  summary: MonitoringReferralsSummaryDto;

  @ApiProperty({ type: [MonitoringReferralsCenterItemDto] })
  items: MonitoringReferralsCenterItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
