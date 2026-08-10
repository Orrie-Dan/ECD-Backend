import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuditAction } from '@prisma/client';

export class SyncPushOperationDto {
  /**
   * Stable client-generated operation id. Must be unique per device and reused
   * unchanged on retries so the server can deduplicate push attempts.
   */
  @ApiProperty({
    example: 'op-uuid-or-client-id',
    description:
      'Stable client-generated operation id. Must be unique per device and reused unchanged on retries for deduplication',
  })
  @IsString()
  @IsNotEmpty()
  clientOperationId: string;

  @ApiProperty({ example: 'child' })
  @IsString()
  @IsNotEmpty()
  entityType: string;

  @ApiProperty({
    enum: AuditAction,
    enumName: 'PrismaAuditAction',
    description: 'Prisma audit action: create | update | delete',
  })
  @IsEnum(AuditAction)
  operation: AuditAction;

  @ApiPropertyOptional({
    example: 'local-temp-id',
    description: 'Client-local entity id before server assignment',
  })
  @IsOptional()
  @IsString()
  localId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Entity payload for create/update',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiProperty({
    example: 0,
    minimum: 0,
    description: 'Client-known entity version for optimistic concurrency',
  })
  @IsInt()
  @Min(0)
  version: number;

  @ApiPropertyOptional({
    example: '2026-08-06T12:00:00.000Z',
    description: 'Client-side timestamp when the operation was created',
  })
  @IsOptional()
  @IsString()
  clientTimestamp?: string;
}

export class SyncPushDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deviceId: string;

  @ApiProperty({
    type: [SyncPushOperationDto],
    minItems: 1,
    maxItems: 500,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SyncPushOperationDto)
  operations: SyncPushOperationDto[];
}
