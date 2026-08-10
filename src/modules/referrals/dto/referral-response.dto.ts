import { ApiProperty } from '@nestjs/swagger';

export type ApiReferralStatus = 'pending' | 'completed' | 'cancelled';
export type ApiReferralSourceType = 'nutrition' | 'sted';

export class ReferralResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({
    enum: ['nutrition', 'sted'],
    enumName: 'ApiReferralSourceType',
    example: 'nutrition',
  })
  sourceType: ApiReferralSourceType;

  @ApiProperty({
    format: 'uuid',
    description: 'ID of the source nutrition screening or STED assessment',
  })
  sourceId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-08-06' })
  referralDate: string;

  @ApiProperty({ example: 'Severe malnutrition' })
  reason: string;

  @ApiProperty({ example: 'District hospital' })
  destination: string;

  @ApiProperty({
    enum: ['pending', 'completed', 'cancelled'],
    enumName: 'ApiReferralStatus',
    example: 'pending',
  })
  status: ApiReferralStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  implementedAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ format: 'uuid' })
  recordedBy: string;

  @ApiProperty({
    description: 'Optimistic-lock version; send back on status update',
    example: 1,
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class ReferralHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ type: [ReferralResponseDto] })
  items: ReferralResponseDto[];

  @ApiProperty({ example: 3 })
  total: number;
}

export class PaginatedReferralsResponseDto {
  @ApiProperty({ type: [ReferralResponseDto] })
  items: ReferralResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 50 })
  pageSize: number;

  @ApiProperty({ example: 2 })
  totalPages: number;
}
