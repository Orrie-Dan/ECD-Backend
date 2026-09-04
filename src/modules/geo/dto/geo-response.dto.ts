import { AdministrativeLevel, EcdCenterStatus } from '../../../common/domain';
import { ApiProperty } from '@nestjs/swagger';
export class AdminUnitResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: AdministrativeLevel,
    enumName: 'AdministrativeLevel',
  })
  level: AdministrativeLevel;

  @ApiProperty({ format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ example: 'Kimironko' })
  name: string;

  @ApiProperty({ example: 'VIL-001' })
  code: string;

  @ApiProperty({ example: -1.9441, nullable: true })
  latitude: number | null;

  @ApiProperty({ example: 30.0619, nullable: true })
  longitude: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class DistrictResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  provinceId: string;

  @ApiProperty({ example: 'GAS' })
  code: string;

  @ApiProperty({ example: 'Gasabo' })
  name: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class PaginatedDistrictsResponseDto {
  @ApiProperty({ type: [DistrictResponseDto] })
  items: DistrictResponseDto[];

  @ApiProperty({ example: 30 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 2 })
  totalPages: number;
}

export class CenterInDistrictResponseDto {
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

  @ApiProperty({ enum: EcdCenterStatus, enumName: 'EcdCenterStatus' })
  status: EcdCenterStatus;

  @ApiProperty({ format: 'uuid' })
  villageId: string;

  @ApiProperty({ example: 'Kimironko', nullable: true })
  villageName: string | null;

  @ApiProperty({ example: -1.9441, nullable: true })
  latitude: number | null;

  @ApiProperty({ example: 30.0619, nullable: true })
  longitude: number | null;
}

export class PaginatedCentersInDistrictResponseDto {
  @ApiProperty({ type: [CenterInDistrictResponseDto] })
  items: CenterInDistrictResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}
