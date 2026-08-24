import { ApiProperty } from '@nestjs/swagger';
import { AuditAction, SyncOperationStatus, SyncSessionStatus } from '@prisma/client';

export class SyncPushOperationResultDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'op-uuid-or-client-id' })
  clientOperationId: string;

  @ApiProperty({ example: 'local-temp-id', nullable: true })
  localId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  entityId: string | null;

  @ApiProperty({ example: 'child' })
  entityType: string;

  @ApiProperty({
    enum: AuditAction,
    enumName: 'PrismaAuditAction',
    description: 'Prisma audit action: create | update | delete',
  })
  operation: AuditAction;

  @ApiProperty({
    enum: SyncOperationStatus,
    enumName: 'SyncOperationStatus',
  })
  status: SyncOperationStatus;

  @ApiProperty({ nullable: true })
  conflictReason: string | null;

  @ApiProperty({
    example: false,
    description: 'True when this push replayed a previously accepted operation',
  })
  replayed: boolean;

  @ApiProperty({ format: 'uuid', nullable: true })
  sessionId: string | null;
}

export class SyncPushResponseDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  sessionId: string | null;

  @ApiProperty({ example: 3 })
  accepted: number;

  @ApiProperty({ example: 2 })
  created: number;

  @ApiProperty({ example: 1 })
  deduplicated: number;

  @ApiProperty({
    enum: SyncOperationStatus,
    enumName: 'SyncOperationStatus',
  })
  status: SyncOperationStatus;

  @ApiProperty({ type: [SyncPushOperationResultDto] })
  operations: SyncPushOperationResultDto[];
}

export class SyncPullCursorDto {
  @ApiProperty({
    example: '2026-08-06T12:00:00.000Z',
    description: 'ISO-8601 lastModifiedAt watermark',
  })
  lastModifiedAt: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Tie-breaker id (may be empty string for legacy cursor)',
  })
  id: string;
}

export class SyncPullEntityBucketsDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Opaque Child entity snapshots for offline sync (not the HTTP ChildResponseDto shape).',
  })
  child: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque AttendanceRecord entity snapshots for offline sync.',
  })
  attendance_record: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque ChildNutritionScreening entity snapshots for offline sync.',
  })
  child_nutrition_screening: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque ChildTransfer entity snapshots for offline sync.',
  })
  child_transfer: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque EcdCenter entity snapshots for offline sync.',
  })
  ecd_center: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque ComplianceAssessment entity snapshots for offline sync.',
  })
  compliance_assessment: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque ComplianceAssessmentItem entity snapshots for offline sync.',
  })
  compliance_assessment_item: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque WashIndicator entity snapshots for offline sync.',
  })
  wash_indicator: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque CenterFeedingDay entity snapshots for offline sync.',
  })
  center_feeding_day: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque CenterFeedingMonthSummary entity snapshots for offline sync.',
  })
  center_feeding_month_summary: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque StedAssessment entity snapshots for offline sync.',
  })
  sted_assessment: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Opaque Referral entity snapshots for offline sync.',
  })
  referral: unknown[];
}

export class SyncPullResponseDto {
  @ApiProperty({ type: () => SyncPullCursorDto, nullable: true })
  cursor: SyncPullCursorDto | null;

  @ApiProperty({ type: () => SyncPullCursorDto, nullable: true })
  nextCursor: SyncPullCursorDto | null;

  @ApiProperty({ example: true })
  hasMore: boolean;

  @ApiProperty({ example: 500 })
  limit: number;

  @ApiProperty({ type: () => SyncPullEntityBucketsDto })
  created: SyncPullEntityBucketsDto;

  @ApiProperty({ type: () => SyncPullEntityBucketsDto })
  updated: SyncPullEntityBucketsDto;

  @ApiProperty({ type: () => SyncPullEntityBucketsDto })
  deleted: SyncPullEntityBucketsDto;
}

export class SyncSessionOperationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'op-uuid-or-client-id' })
  clientOperationId: string;

  @ApiProperty({ example: 'child' })
  entityType: string;

  @ApiProperty({
    enum: AuditAction,
    enumName: 'PrismaAuditAction',
  })
  operation: AuditAction;

  @ApiProperty({
    enum: SyncOperationStatus,
    enumName: 'SyncOperationStatus',
  })
  status: SyncOperationStatus;

  @ApiProperty({ nullable: true })
  conflictReason: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  processedAt: Date | null;
}

export class SyncSessionStatusResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: SyncSessionStatus,
    enumName: 'SyncSessionStatus',
  })
  status: SyncSessionStatus;

  @ApiProperty({ example: 10 })
  totalOperations: number;

  @ApiProperty({ example: 8 })
  successfulOperations: number;

  @ApiProperty({ example: 2 })
  failedOperations: number;

  @ApiProperty({ example: 0 })
  retryCount: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastRetryAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;

  @ApiProperty({ type: [SyncSessionOperationDto] })
  operations: SyncSessionOperationDto[];
}
