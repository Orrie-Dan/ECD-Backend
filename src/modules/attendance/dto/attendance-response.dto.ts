import { AbsentReason } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: '2024-06-15', description: 'Attendance date (YYYY-MM-DD)' })
  date: string;

  @ApiProperty({ example: true })
  present: boolean;

  @ApiProperty({
    enum: AbsentReason,
    enumName: 'AbsentReason',
    nullable: true,
    example: AbsentReason.sick,
  })
  absentReason: AbsentReason | null;

  @ApiProperty({ nullable: true, example: 'Arrived late' })
  notes: string | null;

  @ApiProperty({ format: 'uuid', description: 'User who recorded the attendance' })
  recordedBy: string;

  @ApiProperty({ example: 1, description: 'Optimistic-lock version' })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class AttendanceBatchResultItemDto {
  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ example: '2024-06-15' })
  date: string;

  @ApiPropertyOptional({ example: 'local-att-001' })
  localId?: string;

  @ApiProperty({
    enum: ['created', 'updated', 'failed', 'forbidden', 'not_found', 'conflict'],
    enumName: 'AttendanceBatchOutcome',
    example: 'created',
  })
  outcome: 'created' | 'updated' | 'failed' | 'forbidden' | 'not_found' | 'conflict';

  @ApiPropertyOptional({ type: () => AttendanceResponseDto })
  attendance?: AttendanceResponseDto;

  @ApiPropertyOptional({ example: 'Child not found at center' })
  message?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Current server version on conflict',
  })
  currentVersion?: number;
}

export class AttendanceBatchResultDto {
  @ApiProperty({ example: 3 })
  created: number;

  @ApiProperty({ example: 1 })
  updated: number;

  @ApiProperty({ example: 0 })
  failed: number;

  @ApiProperty({ type: () => [AttendanceBatchResultItemDto] })
  items: AttendanceBatchResultItemDto[];
}

export class PaginatedAttendanceResponseDto {
  @ApiProperty({ type: () => [AttendanceResponseDto] })
  items: AttendanceResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 50 })
  pageSize: number;

  @ApiProperty({ example: 2 })
  totalPages: number;
}
