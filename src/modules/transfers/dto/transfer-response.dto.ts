import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';

export class TransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ format: 'uuid' })
  fromCenterId: string;

  @ApiProperty({ format: 'uuid' })
  toCenterId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  transferDate: Date;

  @ApiProperty({ example: 'Family relocated' })
  reason: string;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({
    enum: TransferStatus,
    enumName: 'TransferStatus',
    example: TransferStatus.pending,
  })
  status: TransferStatus;

  @ApiProperty({ format: 'uuid', description: 'User ID who initiated the transfer' })
  initiatedBy: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  acceptedAt: Date | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  acceptedBy: string | null;

  @ApiProperty({
    description: 'Optimistic-lock version; send back on accept/cancel',
    example: 1,
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class PaginatedTransfersResponseDto {
  @ApiProperty({ type: () => [TransferResponseDto] })
  items: TransferResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export class TransferHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ type: () => [TransferResponseDto] })
  items: TransferResponseDto[];

  @ApiProperty({ example: 5 })
  total: number;

  @ApiPropertyOptional({ example: 1 })
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  pageSize?: number;

  @ApiPropertyOptional({ example: 1 })
  totalPages?: number;
}

export class CenterTransferHistoryItemDto extends TransferResponseDto {
  @ApiProperty({
    enum: ['incoming', 'outgoing'],
    description:
      'Relative to the requested center: incoming when toCenterId matches, outgoing when fromCenterId matches.',
    example: 'incoming',
  })
  direction: 'incoming' | 'outgoing';
}

export class CenterTransferHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ type: () => [CenterTransferHistoryItemDto] })
  items: CenterTransferHistoryItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiPropertyOptional({ example: 1 })
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  pageSize?: number;

  @ApiPropertyOptional({ example: 1 })
  totalPages?: number;
}
