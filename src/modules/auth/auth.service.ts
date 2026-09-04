import { UserAccountStatus, UserRole, asDomainEnum } from '../../common/domain';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthTokensResponseDto } from './dto/auth-tokens-response.dto';
import { AuthMeResponseDto, AuthUserResponseDto } from './dto/auth-user-response.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { AuthUser, JwtPayload } from './interfaces/jwt-payload.interface';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokensResponseDto> {
    const user = await this.prisma.userAccount.findUnique({
      where: { username: dto.username },
      include: {
        center: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account is temporarily locked. Try again later.');
    }

    if (user.status !== UserAccountStatus.active) {
      throw new ForbiddenException('Account is inactive');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      await this.handleFailedLogin(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException('Invalid username or password');
    }

    await this.prisma.userAccount.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    return this.issueTokens({
      id: user.id,
      username: user.username,
      role: asDomainEnum<UserRole>(user.role),
      districtId: user.districtId,
      centerId: user.centerId,
      center: user.center,
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokensResponseDto> {
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.userAccount.findUnique({
      where: { id: payload.sub },
      include: {
        center: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!user || user.status !== UserAccountStatus.active) {
      throw new UnauthorizedException('User account is not active');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account is temporarily locked');
    }

    return this.issueTokens({
      id: user.id,
      username: user.username,
      role: asDomainEnum<UserRole>(user.role),
      districtId: user.districtId,
      centerId: user.centerId,
      center: user.center,
    });
  }

  async me(authUser: AuthUser): Promise<AuthMeResponseDto> {
    const user = await this.prisma.userAccount.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        districtId: true,
        centerId: true,
        center: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: asDomainEnum<UserRole>(user.role),
      districtId: user.districtId,
      centerId: user.centerId,
      center: user.center,
    };
  }

  /**
   * Secure stub: always returns accepted:true without revealing whether the user exists.
   * Creates a hashed PasswordResetToken when a matching account is found.
   */
  async requestPasswordReset(dto: PasswordResetRequestDto): Promise<{ accepted: true }> {
    if (!dto.username && !dto.email) {
      throw new BadRequestException('username or email is required');
    }

    const user = await this.prisma.userAccount.findFirst({
      where: {
        OR: [
          ...(dto.username ? [{ username: dto.username }] : []),
          ...(dto.email ? [{ email: dto.email }] : []),
        ],
      },
      select: { id: true },
    });

    if (user) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashResetToken(rawToken);

      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });

      // Stub: no email/SMS delivery yet. Log raw token outside production for local confirm testing.
      if (this.config.get<string>('NODE_ENV') !== 'production') {
        this.logger.warn(
          `Password reset token created for user ${user.id} (dev stub): ${rawToken}`,
        );
      }
    }

    return { accepted: true };
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<{ success: true }> {
    const tokenHash = this.hashResetToken(dto.token);
    const now = new Date();

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: { id: true, status: true },
        },
      },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= now ||
      resetToken.user.status !== UserAccountStatus.active
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await this.hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          passwordChangedAt: now,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now },
      }),
    ]);

    return { success: true };
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }

  private hashResetToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private async issueTokens(user: {
    id: string;
    username: string;
    role: UserRole;
    districtId: string | null;
    centerId: string | null;
    center: AuthUserResponseDto['center'];
  }): Promise<AuthTokensResponseDto> {
    const accessExpiresIn = this.config.get<string>('JWT_EXPIRES_IN', '15m');
    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');

    const accessPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: asDomainEnum<UserRole>(user.role),
      districtId: user.districtId,
      centerId: user.centerId,
      type: 'access',
    };

    const refreshPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: asDomainEnum<UserRole>(user.role),
      districtId: user.districtId,
      centerId: user.centerId,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: asDomainEnum<UserRole>(user.role),
        districtId: user.districtId,
        centerId: user.centerId,
        center: user.center,
      },
    };
  }

  private async handleFailedLogin(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const data: { failedLoginAttempts: number; lockedUntil?: Date } = {
      failedLoginAttempts: attempts,
    };

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      data.failedLoginAttempts = 0;
    }

    await this.prisma.userAccount.update({
      where: { id: userId },
      data,
    });
  }
}
