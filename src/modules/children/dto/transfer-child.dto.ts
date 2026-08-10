import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferChildDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Destination ECD center UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  toCenterId: string;

  @ApiProperty({
    example: '2024-06-15',
    description: 'Transfer date (ISO-8601)',
  })
  @IsDateString()
  transferDate: string;

  @ApiProperty({
    example: 'Family relocated',
    minLength: 1,
    maxLength: 255,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason: string;

  @ApiPropertyOptional({ example: 'Sibling already enrolled at destination' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Originating device UUID for offline sync',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
