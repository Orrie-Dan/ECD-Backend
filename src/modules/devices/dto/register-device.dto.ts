import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    maxLength: 255,
    description: 'Stable client-generated device identifier',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceUuid: string;

  @ApiPropertyOptional({
    example: 'android',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  platform?: string;

  @ApiPropertyOptional({
    example: '1.2.0',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
