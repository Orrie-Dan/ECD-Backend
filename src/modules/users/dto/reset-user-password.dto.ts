import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetUserPasswordDto {
  /**
   * Optional explicit password set by an authorized admin.
   * If omitted, a temporary password is generated and a reset token is issued
   * (raw token logged only outside production, matching AuthService).
   */
  @ApiPropertyOptional({
    minLength: 8,
    maxLength: 128,
    description:
      'Optional explicit password. If omitted, a temporary password is generated and a reset token is issued.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword?: string;
}
