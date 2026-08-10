import { ApiProperty } from '@nestjs/swagger';

export class WashIndicatorResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'Kigali ECD Center', nullable: true })
  centerName: string | null;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  recordedDate: Date;

  @ApiProperty({ example: true })
  waterSourceAvailable: boolean;

  @ApiProperty({ example: 'piped', nullable: true })
  waterSourceType: string | null;

  @ApiProperty({ example: true })
  sanitationFacilityAvailable: boolean;

  @ApiProperty({ example: 2, nullable: true })
  latrineCount: number | null;

  @ApiProperty({ example: true })
  handwashingFacilityAvailable: boolean;

  @ApiProperty({ example: true })
  wasteManagementAvailable: boolean;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty({ format: 'uuid' })
  recordedById: string;

  @ApiProperty({
    example: 1,
    description: 'Optimistic-lock version; required on updates',
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class PaginatedWashIndicatorsResponseDto {
  @ApiProperty({ type: [WashIndicatorResponseDto] })
  items: WashIndicatorResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}
