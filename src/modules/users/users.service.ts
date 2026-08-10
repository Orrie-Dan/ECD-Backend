import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  UserAccountStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import {
  assertCenterAccess,
  assertDistrictAccess,
  canAccessDistrict,
} from '../../common/auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  CreateUserResponseDto,
  PaginatedUsersResponseDto,
  ResetUserPasswordResponseDto,
  UserResponseDto,
} from './dto/user-response.dto';
import { UserWithRelations, userMapper } from './mappers/user.mapper';

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
/** Readable temp password length (unambiguous alphabet → ~59 bits at 10 chars). */
const TEMP_PASSWORD_LENGTH = 10;
const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  async create(
    actor: AuthUser,
    dto: CreateUserDto,
  ): Promise<CreateUserResponseDto> {
    this.assertCanManageUsers(actor);
    this.assertCanCreateRole(actor, dto.role);

    const mapped = userMapper.toCreateInput(dto);
    const { districtId, centerId } = await this.resolveScopeForRole(
      actor,
      mapped.role,
      mapped.districtId,
      mapped.centerId,
    );

    const existing = await this.prisma.userAccount.findUnique({
      where: { username: mapped.username },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Username is already taken');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.authService.hashPassword(temporaryPassword);
    const rawResetToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawResetToken);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.userAccount.create({
        data: {
          username: mapped.username,
          fullName: mapped.fullName,
          phone: mapped.phone,
          role: mapped.role,
          districtId,
          centerId,
          passwordHash,
          status: UserAccountStatus.active,
          passwordChangedAt: null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: this.defaultInclude(),
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });

      return user;
    });

    this.logProvisioningSecrets(created.id, rawResetToken);

    return {
      ...userMapper.toDto(created as UserWithRelations),
      temporaryPassword,
      mustChangePassword: true,
    };
  }

  async findAll(
    actor: AuthUser,
    query: ListUsersQueryDto,
  ): Promise<PaginatedUsersResponseDto> {
    this.assertCanManageUsers(actor);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where = this.buildListWhere(actor, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.userAccount.findMany({
        where,
        include: this.defaultInclude(),
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.userAccount.count({ where }),
    ]);

    const data = rows.map((row) => userMapper.toDto(row as UserWithRelations));
    return {
      data,
      items: data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async findOne(actor: AuthUser, id: string): Promise<UserResponseDto> {
    this.assertCanManageUsers(actor);
    const user = await this.requireVisibleUser(actor, id);
    return userMapper.toDto(user);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    this.assertCanManageUsers(actor);
    await this.requireVisibleUser(actor, id);

    const mapped = userMapper.toUpdateInput(dto);
    if (Object.keys(mapped).length === 0) {
      throw new BadRequestException('No updatable fields provided');
    }

    const updated = await this.prisma.userAccount.update({
      where: { id },
      data: {
        ...mapped,
        updatedById: actor.id,
      },
      include: this.defaultInclude(),
    });

    return userMapper.toDto(updated as UserWithRelations);
  }

  async resetPassword(
    actor: AuthUser,
    id: string,
    dto: ResetUserPasswordDto,
  ): Promise<ResetUserPasswordResponseDto> {
    this.assertCanManageUsers(actor);
    const target = await this.requireVisibleUser(actor, id);
    this.assertCanResetPassword(actor, target);

    const explicitPassword = dto.newPassword?.trim();
    const generated = !explicitPassword;
    const plain = explicitPassword || this.generateTemporaryPassword();
    const passwordHash = await this.authService.hashPassword(plain);
    const rawResetToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawResetToken);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id },
        data: {
          passwordHash,
          // Generated temps require first-login change; explicit admin sets do not.
          passwordChangedAt: generated ? null : now,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedById: actor.id,
        },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: id,
          tokenHash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      }),
    ]);

    this.logProvisioningSecrets(id, rawResetToken);

    if (generated) {
      return {
        success: true,
        temporaryPassword: plain,
        mustChangePassword: true,
      };
    }

    return { success: true, mustChangePassword: false };
  }

  /**
   * Creation permission matrix (no role escalation).
   * Exported for authorization unit tests.
   */
  canCreateRole(actor: AuthUser, targetRole: UserRole): boolean {
    if (actor.role === UserRole.caregiver) {
      return false;
    }
    if (actor.role === UserRole.ncda_admin) {
      return (
        targetRole === UserRole.district_focal_person ||
        targetRole === UserRole.caregiver
      );
    }
    if (actor.role === UserRole.district_focal_person) {
      return targetRole === UserRole.caregiver;
    }
    return false;
  }

  /**
   * Password-reset permission matrix.
   * Exported for authorization unit tests.
   */
  canResetPassword(
    actor: AuthUser,
    target: Pick<UserWithRelations, 'role' | 'districtId'>,
  ): boolean {
    if (actor.role === UserRole.caregiver) {
      return false;
    }
    if (actor.role === UserRole.ncda_admin) {
      return true;
    }
    if (actor.role === UserRole.district_focal_person) {
      return (
        target.role === UserRole.caregiver &&
        target.districtId != null &&
        actor.districtId != null &&
        target.districtId === actor.districtId
      );
    }
    return false;
  }

  private assertCanManageUsers(actor: AuthUser): void {
    if (
      actor.role !== UserRole.ncda_admin &&
      actor.role !== UserRole.district_focal_person
    ) {
      throw new ForbiddenException('You do not have access to user management');
    }
  }

  private assertCanCreateRole(actor: AuthUser, targetRole: UserRole): void {
    if (!this.canCreateRole(actor, targetRole)) {
      throw new ForbiddenException(
        `Role ${actor.role} cannot create users with role ${targetRole}`,
      );
    }
  }

  private assertCanResetPassword(
    actor: AuthUser,
    target: UserWithRelations,
  ): void {
    if (!this.canResetPassword(actor, target)) {
      throw new ForbiddenException(
        'You are not allowed to reset this user password',
      );
    }
  }

  private async resolveScopeForRole(
    actor: AuthUser,
    role: UserRole,
    districtId: string | null,
    centerId: string | null,
  ): Promise<{ districtId: string | null; centerId: string | null }> {
    if (role === UserRole.ncda_admin) {
      if (districtId || centerId) {
        throw new BadRequestException(
          'ncda_admin must not have districtId or centerId',
        );
      }
      return { districtId: null, centerId: null };
    }

    if (role === UserRole.district_focal_person) {
      if (!districtId) {
        throw new BadRequestException(
          'districtId is required for district_focal_person',
        );
      }
      if (centerId) {
        throw new BadRequestException(
          'centerId must be null for district_focal_person',
        );
      }
      assertDistrictAccess(actor, districtId);
      await this.requireDistrict(districtId);
      return { districtId, centerId: null };
    }

    // caregiver
    if (!centerId) {
      throw new BadRequestException('centerId is required for caregiver');
    }
    if (districtId) {
      // Accept only when it matches the center's district (validated below).
    }

    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: centerId, deletedAt: null },
      select: { id: true, districtId: true },
    });
    if (!center) {
      throw new NotFoundException(`Center ${centerId} not found`);
    }

    if (districtId && districtId !== center.districtId) {
      throw new BadRequestException(
        'districtId does not match the selected center district',
      );
    }

    assertCenterAccess(actor, center.id, center.districtId);

    if (
      actor.role === UserRole.district_focal_person &&
      (!actor.districtId || actor.districtId !== center.districtId)
    ) {
      throw new ForbiddenException(
        'Caregiver center must belong to your district',
      );
    }

    return { districtId: center.districtId, centerId: center.id };
  }

  private buildListWhere(
    actor: AuthUser,
    query: ListUsersQueryDto,
  ): Prisma.UserAccountWhereInput {
    const and: Prisma.UserAccountWhereInput[] = [];

    if (actor.role === UserRole.district_focal_person) {
      if (!actor.districtId) {
        throw new ForbiddenException('District scope is required for this role');
      }
      and.push({ districtId: actor.districtId });
    }

    if (query.role) {
      and.push({ role: query.role });
    }
    if (query.status) {
      and.push({ status: userMapper.toDbStatus(query.status) });
    }
    if (query.districtId) {
      if (
        actor.role === UserRole.district_focal_person &&
        !canAccessDistrict(actor, query.districtId)
      ) {
        throw new ForbiddenException(
          `You do not have access to district ${query.districtId}`,
        );
      }
      and.push({ districtId: query.districtId });
    }
    if (query.centerId) {
      and.push({ centerId: query.centerId });
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      and.push({
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { fullName: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private async requireVisibleUser(
    actor: AuthUser,
    id: string,
  ): Promise<UserWithRelations> {
    const user = await this.prisma.userAccount.findUnique({
      where: { id },
      include: this.defaultInclude(),
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    if (actor.role === UserRole.district_focal_person) {
      if (
        !user.districtId ||
        !actor.districtId ||
        user.districtId !== actor.districtId
      ) {
        throw new ForbiddenException(
          `You do not have access to user ${id}`,
        );
      }
    }

    return user as UserWithRelations;
  }

  private async requireDistrict(districtId: string): Promise<void> {
    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
      select: { id: true },
    });
    if (!district) {
      throw new NotFoundException(`District ${districtId} not found`);
    }
  }

  private defaultInclude() {
    return {
      district: { select: { id: true, name: true } },
      center: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, username: true, fullName: true } },
    } as const;
  }

  private generateTemporaryPassword(): string {
    const bytes = randomBytes(TEMP_PASSWORD_LENGTH);
    let password = '';
    for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
      password +=
        TEMP_PASSWORD_ALPHABET[bytes[i]! % TEMP_PASSWORD_ALPHABET.length];
    }
    return password;
  }

  private hashResetToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private logProvisioningSecrets(userId: string, rawResetToken: string): void {
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn(
        `User provisioning reset token for user ${userId} (dev stub): ${rawResetToken}`,
      );
    }
  }
}
