import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiUserStatus } from './user-response.dto';

const API_STATUSES: ApiUserStatus[] = ['ACTIVE', 'SUSPENDED'];

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Jane Doe',
    minLength: 1,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({
    example: '+250788123456',
    maxLength: 50,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiPropertyOptional({
    enum: API_STATUSES,
    enumName: 'ApiUserStatus',
  })
  @IsOptional()
  @IsIn(API_STATUSES)
  status?: ApiUserStatus;
}
