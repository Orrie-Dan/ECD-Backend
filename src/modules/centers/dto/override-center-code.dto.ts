import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NCDA_ECD_CODE_PATTERN } from '../ecd-code';

export class OverrideCenterCodeDto {
  @ApiProperty({
    example: '0101010101/C/2020/07',
    description:
      'Replacement NCDA code (PPDDSSCCVV/T/YYYY/NN). Must match the center’s current village, ' +
      'ncdaTypeCode and startYear (correct those first) and must never have been issued',
  })
  @Matches(NCDA_ECD_CODE_PATTERN, { message: 'code must match PPDDSSCCVV/T/YYYY/NN' })
  code: string;

  @ApiProperty({ example: 'Registered under the wrong village', minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
