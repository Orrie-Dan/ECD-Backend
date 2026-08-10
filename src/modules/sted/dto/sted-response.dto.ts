import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** API age band (never expose Prisma StedAgeBand). */
export type ApiStedAgeBand = '1_3' | '4_6';

export class StedAssessmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-08-06' })
  assessmentDate: string;

  @ApiProperty({
    enum: ['1_3', '4_6'],
    enumName: 'ApiStedAgeBand',
    example: '1_3',
  })
  ageBand: ApiStedAgeBand;

  @ApiProperty({ example: true })
  consentObtained: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
  })
  physicalAssessment: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
  })
  milestoneResults: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
  })
  outcome: Record<string, unknown>;

  @ApiProperty({ example: true })
  followUpIn6Months: boolean;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  followUpDueDate: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ format: 'uuid' })
  assessedBy: string;

  @ApiProperty({
    description: 'Optimistic-lock version',
    example: 1,
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class StedHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ type: [StedAssessmentResponseDto] })
  items: StedAssessmentResponseDto[];

  @ApiProperty({ example: 5 })
  total: number;

  @ApiPropertyOptional({ example: 1 })
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  pageSize?: number;

  @ApiPropertyOptional({ example: 1 })
  totalPages?: number;
}
