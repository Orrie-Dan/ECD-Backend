import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class PromoteChildDto {
  @ApiProperty({
    example: '2027-01-15',
    description: 'Effective date for the promotion (ISO-8601)',
  })
  @IsDateString()
  effectiveDate: string;
}

export class BulkPromoteDto {
  @ApiProperty({
    example: '2027-01-15',
    description: 'Effective date for bulk promotion (ISO-8601)',
  })
  @IsDateString()
  effectiveDate: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Child IDs to exclude from promotion',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  excludeChildIds?: string[];
}
