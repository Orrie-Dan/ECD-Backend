import {
  AssessmentStatus,
  AssessmentType,
  GapSeverity,
  GapStatus,
  ItemResponse,
  StandardDomain,
} from '../../../common/domain';
import { ApiProperty } from '@nestjs/swagger';
import { ComplianceClassification } from '@prisma/client';
export class AssessmentItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  assessmentId: string;

  @ApiProperty({ format: 'uuid' })
  standardId: string;

  @ApiProperty({ enum: ItemResponse, enumName: 'ItemResponse' })
  response: ItemResponse;

  @ApiProperty({ example: 1, nullable: true })
  score: number | null;

  @ApiProperty({ example: 'Evidence notes', nullable: true })
  evidenceNotes: string | null;

  @ApiProperty({
    enum: GapSeverity,
    enumName: 'GapSeverity',
    nullable: true,
  })
  gapSeverity: GapSeverity | null;

  @ApiProperty({ example: 'Install handwashing station', nullable: true })
  gapImprovementAction: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  gapTargetDate: Date | null;

  @ApiProperty({
    enum: GapStatus,
    enumName: 'GapStatus',
    nullable: true,
  })
  gapStatus: GapStatus | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  gapResolvedAt: Date | null;

  @ApiProperty({
    example: 1,
    description: 'Optimistic-lock version; required on updates',
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class AssessmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center', nullable: true })
  centerName: string | null;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ example: '2024.1' })
  standardsVersion: string;

  @ApiProperty({ enum: AssessmentType, enumName: 'AssessmentType' })
  assessmentType: AssessmentType;

  @ApiProperty({ type: String, format: 'date-time' })
  assessmentDate: Date;

  @ApiProperty({ enum: AssessmentStatus, enumName: 'AssessmentStatus' })
  status: AssessmentStatus;

  @ApiProperty({ format: 'uuid', nullable: true })
  submittedById: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt: Date | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  verifiedById: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verifiedAt: Date | null;

  @ApiProperty({
    enum: ComplianceClassification,
    enumName: 'ComplianceClassification',
    nullable: true,
  })
  overallClassification: ComplianceClassification | null;

  @ApiProperty({
    example: 1,
    description: 'Optimistic-lock version; required on updates',
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class AssessmentDetailResponseDto extends AssessmentResponseDto {
  @ApiProperty({ type: [AssessmentItemResponseDto] })
  items: AssessmentItemResponseDto[];
}

export class PaginatedAssessmentsResponseDto {
  @ApiProperty({ type: [AssessmentResponseDto] })
  items: AssessmentResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export class StandardResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: StandardDomain, enumName: 'StandardDomain' })
  domain: StandardDomain;

  @ApiProperty({ example: 'WASH-01' })
  code: string;

  @ApiProperty({ example: 'Safe drinking water available' })
  title: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ example: 1, nullable: true })
  weight: number | null;

  @ApiProperty({ example: '2024.1' })
  version: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}
