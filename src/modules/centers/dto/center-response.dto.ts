import { EcdCenterStatus } from '../../../common/domain';
import { ApiProperty } from '@nestjs/swagger';
import { ComplianceClassification } from '@prisma/client';
export class CenterResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ECD-001' })
  code: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  name: string;

  @ApiProperty({ example: '+250788123456', nullable: true })
  phone: string | null;

  @ApiProperty({ example: 40, nullable: true })
  capacity: number | null;

  @ApiProperty({ example: -1.9441, nullable: true })
  latitude: number | null;

  @ApiProperty({ example: 30.0619, nullable: true })
  longitude: number | null;

  @ApiProperty({ enum: EcdCenterStatus, enumName: 'EcdCenterStatus' })
  status: EcdCenterStatus;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ example: 'Gasabo', nullable: true })
  districtName: string | null;

  @ApiProperty({ format: 'uuid' })
  villageId: string;

  @ApiProperty({ example: 'Kimironko', nullable: true })
  villageName: string | null;

  @ApiProperty({
    enum: ComplianceClassification,
    enumName: 'ComplianceClassification',
    nullable: true,
  })
  currentComplianceLevel: ComplianceClassification | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  currentComplianceAssessedAt: Date | null;

  @ApiProperty({ example: 25 })
  activeChildrenCount: number;

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

export class CenterDetailResponseDto extends CenterResponseDto {
  @ApiProperty({ example: 'Kigali', nullable: true })
  provinceName: string | null;

  @ApiProperty({ example: 3 })
  caregiversCount: number;

  @ApiProperty({ example: 20 })
  attendancePresentToday: number;

  @ApiProperty({ example: 5 })
  attendanceAbsentToday: number;

  @ApiProperty({ example: 2 })
  pendingReferralsCount: number;
}

export class PaginatedCentersResponseDto {
  @ApiProperty({ type: [CenterResponseDto] })
  items: CenterResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}
