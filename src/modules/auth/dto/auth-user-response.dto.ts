import { UserRole } from '../../../common/domain';
import { ApiProperty } from '@nestjs/swagger';
export class AuthCenterSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ECD-001' })
  code: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  name: string;
}

export class AuthUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'caregiver01' })
  username: string;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ type: () => AuthCenterSummaryDto, nullable: true })
  center: AuthCenterSummaryDto | null;
}

/** GET /auth/me — extends token user summary with profile fields already returned at runtime. */
export class AuthMeResponseDto extends AuthUserResponseDto {
  @ApiProperty({
    nullable: true,
    example: 'caregiver01@example.com',
    description: 'Account email when set',
  })
  email: string | null;

  @ApiProperty({ example: 'Jean Uwimana' })
  fullName: string;
}
