import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EcdCenterStatus } from '@prisma/client';

/** Daily enrollment trend point. */
export class EnrollmentTrendPointDto {
  @ApiProperty({ example: '2026-08-06' })
  date: string;

  @ApiProperty({ example: 3 })
  newRegistrations: number;
}

export class EnrollmentSummaryDto {
  @ApiProperty({ example: 100 })
  totalEnrolled: number;

  @ApiProperty({ example: 80 })
  active: number;

  @ApiProperty({ example: 10 })
  archived: number;

  @ApiProperty({ example: 10 })
  transferred: number;

  @ApiProperty({ example: 5 })
  newRegistrations: number;
}

export class DropoutInterpretationDto {
  @ApiProperty({
    example:
      'Children with status=archived and archivedAt within the date range',
  })
  dropoutDefinition: string;

  @ApiProperty({
    example:
      'Transferred children (status=transferred) are reported as transfersOut, not dropouts',
  })
  excluded: string;

  @ApiProperty({
    example:
      'No dedicated dropout enum exists; archived is the existing lifecycle terminal used for leaving the program',
  })
  note: string;
}

export class EnrollmentReportResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  centerId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: () => DropoutInterpretationDto,
    description:
      'Always null on enrollment reports (dropout interpretation lives on /reports/dropouts)',
    example: null,
  })
  interpretation?: DropoutInterpretationDto | null;

  @ApiProperty({ type: () => EnrollmentSummaryDto })
  summary: EnrollmentSummaryDto;

  @ApiProperty({ type: [EnrollmentTrendPointDto] })
  trend: EnrollmentTrendPointDto[];
}

export class DropoutSummaryDto {
  @ApiProperty({ example: 4 })
  dropouts: number;

  @ApiProperty({ example: 2 })
  transfersOut: number;
}

export class DropoutItemDto {
  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ example: 'Jane Doe' })
  childName: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  centerName: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt: string | null;

  @ApiProperty({ example: 'Moved away', nullable: true })
  archiveReason: string | null;
}

export class DropoutsReportResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  districtId?: string | null;

  @ApiProperty({ type: () => DropoutInterpretationDto })
  interpretation: DropoutInterpretationDto;

  @ApiProperty({ type: () => DropoutSummaryDto })
  summary: DropoutSummaryDto;

  @ApiProperty({ type: [DropoutItemDto] })
  items: DropoutItemDto[];

  @ApiProperty({ example: 4 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class CenterReportAttendanceDto {
  @ApiProperty({ example: 32 })
  present: number;

  @ApiProperty({ example: 8 })
  absent: number;

  @ApiProperty({ example: 80, nullable: true })
  rate: number | null;
}

export class CenterReportNutritionDto {
  @ApiProperty({ example: 1 })
  severeScreenings: number;
}

export class CenterReportFeedingDto {
  @ApiProperty({ example: 5 })
  daysRecorded: number;
}

export class CenterReportReferralsDto {
  @ApiProperty({ example: 2 })
  pending: number;
}

export class CenterReportStedDto {
  @ApiProperty({ example: 8 })
  assessmentsCompleted: number;
}

export class CenterReportItemDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'ECD-001' })
  centerCode: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  centerName: string;

  @ApiProperty({ enum: EcdCenterStatus, enumName: 'EcdCenterStatus' })
  status: EcdCenterStatus;

  @ApiProperty({ example: 40 })
  enrolledChildren: number;

  @ApiProperty({ type: () => CenterReportAttendanceDto })
  attendance: CenterReportAttendanceDto;

  @ApiProperty({ type: () => CenterReportNutritionDto })
  nutrition: CenterReportNutritionDto;

  @ApiProperty({ type: () => CenterReportFeedingDto })
  feeding: CenterReportFeedingDto;

  @ApiProperty({ type: () => CenterReportReferralsDto })
  referrals: CenterReportReferralsDto;

  @ApiProperty({ type: () => CenterReportStedDto })
  sted: CenterReportStedDto;
}

export class CentersReportResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ type: [CenterReportItemDto] })
  items: CenterReportItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class DistrictReportKpisDto {
  @ApiProperty({ example: 12 })
  centersInScope: number;

  @ApiProperty({ example: 80 })
  activeChildren: number;

  @ApiProperty({ example: 5 })
  newRegistrations: number;

  @ApiProperty({ example: 2 })
  dropouts: number;

  @ApiProperty({ example: 87.5, nullable: true })
  attendanceRate: number | null;

  @ApiProperty({ example: 50 })
  nutritionScreenings: number;

  @ApiProperty({ example: 2 })
  severeNutrition: number;

  @ApiProperty({ example: 3 })
  pendingReferrals: number;

  @ApiProperty({ example: 15 })
  feedingDaysRecorded: number;

  @ApiProperty({ example: 20 })
  stedAssessments: number;
}

export class DistrictReportResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-08-06T23:59:59.999Z' })
  to: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ type: () => DistrictReportKpisDto })
  kpis: DistrictReportKpisDto;
}
