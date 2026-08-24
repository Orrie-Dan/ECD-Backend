import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuthErrors, ErrorResponseDto } from '../../common/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthTokensResponseDto } from './dto/auth-tokens-response.dto';
import { AuthMeResponseDto } from './dto/auth-user-response.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthUser } from './interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticates with username/password and returns access + refresh tokens and user summary.',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or invalid credentials payload',
    type: ErrorResponseDto,
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh tokens',
    description: 'Exchanges a valid refresh token for a new access + refresh token pair.',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or refresh token rejected',
    type: ErrorResponseDto,
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary: 'Current user profile',
    description:
      'Returns the authenticated user including email and fullName (in addition to token user summary fields).',
  })
  @ApiOkResponse({ type: AuthMeResponseDto })
  @ApiAuthErrors()
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }

  @Public()
  @Post('password-reset/request')
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Secure stub: always returns `{ accepted: true }` without revealing whether the account exists. ' +
      'Creates a hashed reset token when a matching user is found.',
  })
  @ApiOkResponse({
    description: 'Always accepted (does not reveal account existence)',
    schema: {
      type: 'object',
      properties: {
        accepted: { type: 'boolean', example: true },
      },
      required: ['accepted'],
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (username or email required)',
    type: ErrorResponseDto,
  })
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Public()
  @Post('password-reset/confirm')
  @ApiOperation({
    summary: 'Confirm password reset',
    description:
      'Consumes a valid unused reset token and sets the new password. Returns `{ success: true }`.',
  })
  @ApiOkResponse({
    description: 'Password updated',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
      required: ['success'],
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or invalid/expired reset token',
    type: ErrorResponseDto,
  })
  confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    return this.authService.confirmPasswordReset(dto);
  }
}
