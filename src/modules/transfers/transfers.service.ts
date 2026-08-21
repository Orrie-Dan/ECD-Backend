import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChildStatus,
  DeviceStatus,
  TransferStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  assertCenterAccess,
  canAccessCenter,
} from '../../common/auth/scope.util';
import { OptimisticLockConflictException } from '../../common/concurrency/optimistic-lock.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { SyncAccessService } from '../sync/sync-access.service';
import { AcceptTransferDto } from './dto/accept-transfer.dto';
import { CancelTransferDto } from './dto/cancel-transfer.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import {
  TransferHistoryResponseDto,
  TransferResponseDto,
} from './dto/transfer-response.dto';
import { transferMapper } from './mappers/transfer.mapper';
import { TransferLifecycleService } from './transfer-lifecycle.service';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncAccess: SyncAccessService,
    private readonly lifecycle: TransferLifecycleService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    user: AuthUser,
    dto: CreateTransferDto,
  ): Promise<TransferResponseDto> {
    const child = await this.prisma.child.findFirst({
      where: { id: dto.childId, deletedAt: null },
      include: {
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    if (child.status === ChildStatus.archived) {
      throw new BadRequestException('Cannot transfer an archived child');
    }

    assertCenterAccess(user, child.centerId, child.center.districtId);

    const toCenter = await this.prisma.ecdCenter.findFirst({
      where: { id: dto.toCenterId, deletedAt: null },
      select: { id: true, districtId: true },
    });

    if (!toCenter) {
      throw new NotFoundException('Destination center not found');
    }

    if (dto.toCenterId === child.centerId) {
      throw new BadRequestException('Child is already assigned to this center');
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const transferId = randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      return this.lifecycle.createPending(tx, {
        transferId,
        childId: child.id,
        fromCenterId: child.centerId,
        toCenterId: dto.toCenterId,
        transferDate: new Date(dto.transferDate),
        reason: dto.reason.trim(),
        notes: dto.notes ?? null,
        initiatedById: user.id,
        deviceId,
        childVersion: dto.childVersion,
        updatedById: user.id,
      });
    });

    if (result.status === 'conflict') {
      this.throwTransferConflict(result.conflictReason);
    }

    this.sendTransferNotification(
      'transfer_request',
      dto.toCenterId,
      `Transfer request for ${child.firstName ?? 'child'}`,
      `A child transfer has been requested to your center.`,
      'child_transfer',
      transferId,
    );

    return transferMapper.toDto(result.transfer);
  }

  async accept(
    user: AuthUser,
    id: string,
    dto: AcceptTransferDto,
  ): Promise<TransferResponseDto> {
    const transfer = await this.getTransferOrThrow(id);
    const toCenter = await this.prisma.ecdCenter.findFirst({
      where: { id: transfer.toCenterId, deletedAt: null },
      select: { id: true, districtId: true },
    });

    if (!toCenter) {
      throw new NotFoundException('Destination center not found');
    }

    assertCenterAccess(user, transfer.toCenterId, toCenter.districtId);

    const child = await this.prisma.child.findFirst({
      where: { id: transfer.childId, deletedAt: null },
      select: { id: true, version: true },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);

    const result = await this.prisma.$transaction(async (tx) => {
      return this.lifecycle.accept(tx, {
        transferId: transfer.id,
        acceptedById: user.id,
        deviceId,
        transferVersion: dto.version,
        childVersion: dto.childVersion,
        updatedById: user.id,
      });
    });

    if (result.status === 'conflict') {
      this.throwTransferConflict(result.conflictReason);
    }

    this.sendTransferNotification(
      'transfer_accepted',
      transfer.fromCenterId,
      'Transfer accepted',
      `Your child transfer request has been accepted by the destination center.`,
      'child_transfer',
      transfer.id,
      [UserRole.ecd_director, UserRole.caregiver],
    );

    return transferMapper.toDto(result.transfer);
  }

  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelTransferDto,
  ): Promise<TransferResponseDto> {
    const transfer = await this.getTransferOrThrow(id);
    const fromCenter = await this.prisma.ecdCenter.findFirst({
      where: { id: transfer.fromCenterId, deletedAt: null },
      select: { id: true, districtId: true },
    });

    if (!fromCenter) {
      throw new NotFoundException('Source center not found');
    }

    assertCenterAccess(user, transfer.fromCenterId, fromCenter.districtId);

    const child = await this.prisma.child.findFirst({
      where: { id: transfer.childId, deletedAt: null },
      select: { id: true, version: true },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);

    const result = await this.prisma.$transaction(async (tx) => {
      return this.lifecycle.cancel(tx, {
        transferId: transfer.id,
        deviceId,
        transferVersion: dto.version,
        childVersion: dto.childVersion,
        updatedById: user.id,
      });
    });

    if (result.status === 'conflict') {
      this.throwTransferConflict(result.conflictReason);
    }

    this.sendTransferNotification(
      'transfer_cancelled',
      transfer.toCenterId,
      'Transfer cancelled',
      `A child transfer to your center has been cancelled.`,
      'child_transfer',
      transfer.id,
    );

    return transferMapper.toDto(result.transfer);
  }

  async findIncoming(
    user: AuthUser,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: TransferResponseDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const scope = await this.syncAccess.resolveScope(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const skip = (page - 1) * pageSize;
    const where =
      scope.centerIds === 'all'
        ? {
            status: TransferStatus.pending,
            deletedAt: null,
          }
        : {
            status: TransferStatus.pending,
            deletedAt: null,
            toCenterId: { in: scope.centerIds },
          };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.childTransfer.findMany({
        where,
        orderBy: { transferDate: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.childTransfer.count({ where }),
    ]);

    return {
      items: rows.map((row) => transferMapper.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async findOutgoing(
    user: AuthUser,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: TransferResponseDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const scope = await this.syncAccess.resolveScope(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const skip = (page - 1) * pageSize;
    const where =
      scope.centerIds === 'all'
        ? {
            status: TransferStatus.pending,
            deletedAt: null,
          }
        : {
            status: TransferStatus.pending,
            deletedAt: null,
            fromCenterId: { in: scope.centerIds },
          };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.childTransfer.findMany({
        where,
        orderBy: { transferDate: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.childTransfer.count({ where }),
    ]);

    return {
      items: rows.map((row) => transferMapper.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async findOne(user: AuthUser, id: string): Promise<TransferResponseDto> {
    const transfer = await this.getTransferOrThrow(id);
    const scope = await this.syncAccess.resolveScope(user);

    const accessible =
      scope.centerIds === 'all' ||
      scope.centerIds.includes(transfer.fromCenterId) ||
      scope.centerIds.includes(transfer.toCenterId);

    if (!accessible) {
      throw new ForbiddenException('You do not have access to this transfer');
    }

    return transferMapper.toDto(transfer);
  }

  async getChildHistory(
    user: AuthUser,
    childId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<TransferHistoryResponseDto> {
    await this.assertChildTransferHistoryAccess(user, childId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const skip = (page - 1) * pageSize;
    const where = { childId, deletedAt: null };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.childTransfer.findMany({
        where,
        orderBy: [{ transferDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.childTransfer.count({ where }),
    ]);

    return {
      childId,
      items: rows.map((row) => transferMapper.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  /**
   * Allow history when the caller can access the child's current center,
   * or any from/to center on the child's transfers (so source centers retain
   * visibility after an accepted move).
   */
  private async assertChildTransferHistoryAccess(
    user: AuthUser,
    childId: string,
  ): Promise<void> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        centerId: true,
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    if (canAccessCenter(user, child.centerId, child.center.districtId)) {
      return;
    }

    const scope = await this.syncAccess.resolveScope(user);
    if (scope.centerIds === 'all') {
      return;
    }

    const related = await this.prisma.childTransfer.findFirst({
      where: {
        childId,
        deletedAt: null,
        OR: [
          { fromCenterId: { in: scope.centerIds } },
          { toCenterId: { in: scope.centerIds } },
        ],
      },
      select: { id: true },
    });

    if (!related) {
      throw new ForbiddenException(
        'You do not have access to this child transfer history',
      );
    }
  }

  private async getTransferOrThrow(id: string) {
    const transfer = await this.prisma.childTransfer.findFirst({
      where: { id, deletedAt: null },
    });

    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    return transfer;
  }

  /**
   * Map lifecycle CAS / business conflicts to HTTP responses.
   * Version mismatches → 409; other business conflicts stay 400.
   */
  private throwTransferConflict(reason: string): never {
    const lower = reason.toLowerCase();
    if (
      lower.includes('version') ||
      lower.includes('modified') ||
      lower.includes('concurrent')
    ) {
      const match = /server\s+(\d+)/i.exec(reason);
      const currentVersion = match ? Number(match[1]) : undefined;
      throw new OptimisticLockConflictException(
        'child_transfer',
        Number.isFinite(currentVersion) ? currentVersion : undefined,
      );
    }
    throw new BadRequestException(reason);
  }

  private sendTransferNotification(
    type: 'transfer_request' | 'transfer_accepted' | 'transfer_cancelled',
    centerId: string,
    title: string,
    message: string,
    entityType: string,
    entityId: string,
    roles: UserRole[] = [UserRole.ecd_director],
  ): void {
    this.notifications
      .findUserIdsByRoleAndCenter(centerId, roles)
      .then((userIds) => {
        this.notifications.notifyAsync(userIds, {
          type,
          title,
          message,
          entityType,
          entityId,
        });
      })
      .catch(() => {});
  }

  private async resolveDeviceId(
    user: AuthUser,
    deviceId?: string,
  ): Promise<string | null> {
    if (!deviceId) {
      return null;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device || device.userId !== user.id) {
      throw new ForbiddenException(
        'Device does not belong to the authenticated user',
      );
    }

    if (device.status !== DeviceStatus.active) {
      throw new ForbiddenException('Device is inactive');
    }

    return device.id;
  }
}
