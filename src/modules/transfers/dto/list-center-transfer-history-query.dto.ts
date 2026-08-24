import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const TRANSFER_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

export class ListCenterTransferHistoryQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;

  @ApiPropertyOptional({
    enum: TransferStatus,
    enumName: 'TransferStatus',
    description: 'Filter by transfer status. Omit to include all statuses.',
  })
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  @ApiPropertyOptional({
    enum: TRANSFER_DIRECTIONS,
    description: 'Filter relative to the center: incoming (toCenter) or outgoing (fromCenter).',
  })
  @IsOptional()
  @IsIn(TRANSFER_DIRECTIONS)
  direction?: TransferDirection;
}
