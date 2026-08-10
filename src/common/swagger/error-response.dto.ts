import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard error envelope returned by AllExceptionsFilter.
 * Success responses remain bare DTO bodies (no success envelope).
 */
export class ErrorResponseDto {
  @ApiProperty({ example: false, description: 'Always false for error responses' })
  success: false;

  @ApiProperty({ example: 400, description: 'HTTP status code' })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Validation failed',
    description: 'Error message or validation message array',
  })
  message: string | string[];

  @ApiProperty({
    example: '2026-08-06T12:00:00.000Z',
    description: 'ISO-8601 timestamp when the error was produced',
  })
  timestamp: string;
}

/**
 * HTTP 409 optimistic-lock / conflict response extras merged into the error envelope.
 */
export class ConflictResponseDto extends ErrorResponseDto {
  @ApiProperty({ example: 409 })
  declare statusCode: number;

  @ApiProperty({
    example: 'Record was modified by another device',
  })
  declare message: string | string[];

  @ApiProperty({
    example: 'Child',
    description: 'Entity type that conflicted (optimistic lock)',
  })
  entity: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Current server version when known; client should refresh and retry',
  })
  currentVersion?: number;
}
