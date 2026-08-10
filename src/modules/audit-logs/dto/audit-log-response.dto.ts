import { ApiProperty } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Child' })
  entityType: string;

  @ApiProperty({ format: 'uuid' })
  entityId: string;

  @ApiProperty({
    enum: AuditAction,
    enumName: 'PrismaAuditAction',
    description: 'Prisma audit action: create | update | delete',
  })
  action: AuditAction;

  @ApiProperty({ format: 'uuid', nullable: true })
  changedById: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  changedAt: Date;

  @ApiProperty({
    description: 'Previous entity snapshot (JSON)',
    nullable: true,
  })
  oldValues: unknown;

  @ApiProperty({
    description: 'New entity snapshot (JSON)',
    nullable: true,
  })
  newValues: unknown;

  @ApiProperty({
    description: 'Additional audit metadata (JSON)',
    nullable: true,
  })
  metadata: unknown;
}

export class PaginatedAuditLogsResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  items: AuditLogResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}
