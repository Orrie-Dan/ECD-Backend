import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PasswordResetRequestDto {
  @ApiPropertyOptional({
    description: 'Username of the account requesting a password reset',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'Email of the account requesting a password reset',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
