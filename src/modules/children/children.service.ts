import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction as PrismaAuditAction,
  ChildStatus,
  DeviceStatus,
  Prisma,
  RecordSyncStatus,
  SyncOperationStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  AuditAction,
  AuditService,
  toAuditJson,
} from '../../common/audit';
import { assertDistrictAccess } from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { AccessScope, SyncAccessService } from '../sync/sync-access.service';
import { ArchiveChildDto } from './dto/archive-child.dto';
import {
  ChildDetailResponseDto,
  PaginatedChildrenResponseDto,
} from './dto/child-response.dto';
import { CreateChildDto } from './dto/create-child.dto';
import { ListChildrenQueryDto } from './dto/list-children-query.dto';
import { ReactivateChildDto } from './dto/reactivate-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import {
  ChildWithRelations,
  childMapper,
} from './mappers/child.mapper';

@Injectable()
export class ChildrenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncAccess: SyncAccessService,
    private readonly audit: AuditService,
  ) {}

  async create(
    user: AuthUser,
    dto: CreateChildDto,
  ): Promise<ChildDetailResponseDto> {
    if (!dto.fullName && !dto.firstName) {
      throw new BadRequestException('Either fullName or firstName is required');
    }

    const ninGenderDigit = dto.nationalId.charAt(4);
    const expectedDigit = dto.gender === 'Umuhungu' ? '8' : '7';
    if (ninGenderDigit !== expectedDigit) {
      throw new BadRequestException(
        `NIN gender digit (${ninGenderDigit}) does not match the declared gender (${dto.gender})`,
      );
    }

    const scope = await this.syncAccess.resolveScope(user);
    await this.assertCenterAccess(scope, dto.centerId, user);
    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const mapped = childMapper.toCreateData(dto);

    const now = new Date();
    const childId = randomUUID();

    const child = await this.prisma.$transaction(async (tx) => {
      const created = await tx.child.create({
        data: {
          id: childId,
          firstName: mapped.firstName,
          middleName: mapped.middleName,
          lastName: mapped.lastName,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: mapped.gender,
          centerId: mapped.centerId,
          nationalId: dto.nationalId.trim(),
          homeVillageId: dto.homeVillageId,
          guardianName: dto.guardianName.trim(),
          guardianPhone: dto.guardianPhone.trim(),
          guardianRelation: dto.guardianRelation?.trim() || 'guardian',
          guardian2Name: dto.guardian2Name?.trim() ?? null,
          guardian2Phone: dto.guardian2Phone?.trim() ?? null,
          guardian2Relation: dto.guardian2Relation?.trim() ?? null,
          specialNeeds: dto.specialNeeds ?? null,
          disabilityNotes: mapped.disabilityNotes,
          classroomId: dto.classroomId ?? null,
          registeredAt: dto.registeredAt ? new Date(dto.registeredAt) : now,
          status: ChildStatus.active,
          createdById: user.id,
          updatedById: user.id,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
        include: this.defaultInclude(),
      });

      await this.writeSyncOperation(tx, {
        deviceId,
        entityType: 'child',
        entityId: created.id,
        operation: PrismaAuditAction.create,
        payload: created as unknown as Prisma.InputJsonValue,
      });

      await this.audit.log({
        tx,
        entityType: 'child',
        entityId: created.id,
        action: AuditAction.CREATE,
        userId: user.id,
        deviceId,
        oldValues: null,
        newValues: toAuditJson(this.plainChild(created)),
        changedAt: now,
      });

      return created;
    });

    return childMapper.toDetailDto(child as ChildWithRelations);
  }

  async findAll(
    user: AuthUser,
    query: ListChildrenQueryDto,
  ): Promise<PaginatedChildrenResponseDto> {
    const scope = await this.syncAccess.resolveScope(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? query.limit ?? 20;
    const skip = (page - 1) * pageSize;

    if (query.districtId) {
      assertDistrictAccess(user, query.districtId);
    }

    if (query.centerId) {
      await this.assertCenterAccess(scope, query.centerId, user);
    }

    if (query.centerId && query.districtId) {
      const center = await this.prisma.ecdCenter.findFirst({
        where: { id: query.centerId, deletedAt: null },
        select: { id: true, districtId: true },
      });
      if (!center || center.districtId !== query.districtId) {
        throw new BadRequestException(
          'centerId does not belong to the given districtId',
        );
      }
    }

    const statusFilter = childMapper.parseStatusFilter(query.status);

    const where: Prisma.ChildWhereInput = {
      deletedAt: null,
      ...this.syncAccess.centerFilter(scope),
      ...(query.centerId ? { centerId: query.centerId } : {}),
      ...(query.classroomId ? { classroomId: query.classroomId } : {}),
      ...(query.districtId && !query.centerId
        ? {
            center: {
              districtId: query.districtId,
              deletedAt: null,
            },
          }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { middleName: { contains: query.search, mode: 'insensitive' } },
              {
                nationalId: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.child.findMany({
        where,
        include: this.defaultInclude(),
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.child.count({ where }),
    ]);

    return {
      items: rows.map((row) =>
        childMapper.toDto(row as ChildWithRelations),
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async findOne(
    user: AuthUser,
    id: string,
  ): Promise<ChildDetailResponseDto> {
    const child = await this.getAccessibleChild(user, id);
    return childMapper.toDetailDto(child);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateChildDto,
  ): Promise<ChildDetailResponseDto> {
    const existing = await this.getAccessibleChild(user, id);
    const scope = await this.syncAccess.resolveScope(user);

    if (dto.centerId) {
      await this.assertCenterAccess(scope, dto.centerId, user);
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const mapped = childMapper.toUpdateData(dto);
    const now = new Date();

    const child = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.child.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data: {
          ...(mapped.firstName != null && { firstName: mapped.firstName }),
          ...(mapped.middleName !== undefined && {
            middleName: mapped.middleName,
          }),
          ...(mapped.lastName !== undefined && { lastName: mapped.lastName }),
          ...(dto.dateOfBirth != null && {
            dateOfBirth: new Date(dto.dateOfBirth),
          }),
          ...(mapped.gender != null && { gender: mapped.gender }),
          ...(mapped.centerId != null && { centerId: mapped.centerId }),
          ...(dto.homeVillageId != null && { homeVillageId: dto.homeVillageId }),
          ...(dto.guardianName != null && {
            guardianName: dto.guardianName.trim(),
          }),
          ...(dto.guardianPhone != null && {
            guardianPhone: dto.guardianPhone.trim(),
          }),
          ...(dto.guardianRelation != null && {
            guardianRelation: dto.guardianRelation.trim(),
          }),
          ...(dto.guardian2Name !== undefined && {
            guardian2Name: dto.guardian2Name?.trim() ?? null,
          }),
          ...(dto.guardian2Phone !== undefined && {
            guardian2Phone: dto.guardian2Phone?.trim() ?? null,
          }),
          ...(dto.guardian2Relation !== undefined && {
            guardian2Relation: dto.guardian2Relation?.trim() ?? null,
          }),
          ...(dto.specialNeeds !== undefined && {
            specialNeeds: dto.specialNeeds ?? null,
          }),
          ...(mapped.disabilityNotes !== undefined && {
            disabilityNotes: mapped.disabilityNotes,
          }),
          ...(dto.classroomId !== undefined && {
            classroomId: dto.classroomId ?? null,
          }),
          ...(dto.archiveReason !== undefined && {
            archiveReason: dto.archiveReason ?? null,
          }),
          ...(dto.archivedAt !== undefined && {
            archivedAt: dto.archivedAt ? new Date(dto.archivedAt) : null,
          }),
          updatedAt: now,
          updatedById: user.id,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'child', () =>
        tx.child.findUnique({
          where: { id: existing.id },
          select: { version: true },
        }),
      );

      const updated = await tx.child.findFirstOrThrow({
        where: { id: existing.id },
        include: this.defaultInclude(),
      });

      await this.writeSyncOperation(tx, {
        deviceId,
        entityType: 'child',
        entityId: updated.id,
        operation: PrismaAuditAction.update,
        payload: updated as unknown as Prisma.InputJsonValue,
      });

      await this.audit.log({
        tx,
        entityType: 'child',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        deviceId,
        oldValues: toAuditJson(this.plainChild(existing)),
        newValues: toAuditJson(this.plainChild(updated)),
        changedAt: now,
      });

      return updated;
    });

    return childMapper.toDetailDto(child as ChildWithRelations);
  }

  async archive(
    user: AuthUser,
    id: string,
    dto: ArchiveChildDto,
  ): Promise<ChildDetailResponseDto> {
    const existing = await this.getAccessibleChild(user, id);

    if (existing.status === ChildStatus.archived) {
      throw new BadRequestException('Child is already archived');
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();

    const child = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.child.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
          status: { not: ChildStatus.archived },
        },
        data: {
          status: ChildStatus.archived,
          archivedAt: now,
          archiveReason: dto.archiveReason?.trim() ?? existing.archiveReason,
          updatedAt: now,
          updatedById: user.id,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'child', () =>
        tx.child.findUnique({
          where: { id: existing.id },
          select: { version: true },
        }),
      );

      const updated = await tx.child.findFirstOrThrow({
        where: { id: existing.id },
        include: this.defaultInclude(),
      });

      await this.writeSyncOperation(tx, {
        deviceId,
        entityType: 'child',
        entityId: updated.id,
        operation: PrismaAuditAction.update,
        payload: updated as unknown as Prisma.InputJsonValue,
      });

      await this.audit.log({
        tx,
        entityType: 'child',
        entityId: updated.id,
        action: AuditAction.ARCHIVE,
        userId: user.id,
        deviceId,
        oldValues: toAuditJson(this.plainChild(existing)),
        newValues: toAuditJson(this.plainChild(updated)),
        changedAt: now,
      });

      return updated;
    });

    return childMapper.toDetailDto(child as ChildWithRelations);
  }

  async reactivate(
    user: AuthUser,
    id: string,
    dto: ReactivateChildDto,
  ): Promise<ChildDetailResponseDto> {
    const existing = await this.getAccessibleChild(user, id);

    if (existing.status !== ChildStatus.archived) {
      throw new BadRequestException('Only archived children can be reactivated');
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();

    const child = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.child.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
          status: ChildStatus.archived,
        },
        data: {
          status: ChildStatus.active,
          archivedAt: null,
          archiveReason: null,
          updatedAt: now,
          updatedById: user.id,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'child', () =>
        tx.child.findUnique({
          where: { id: existing.id },
          select: { version: true },
        }),
      );

      const updated = await tx.child.findFirstOrThrow({
        where: { id: existing.id },
        include: this.defaultInclude(),
      });

      await this.writeSyncOperation(tx, {
        deviceId,
        entityType: 'child',
        entityId: updated.id,
        operation: PrismaAuditAction.update,
        payload: updated as unknown as Prisma.InputJsonValue,
      });

      await this.audit.log({
        tx,
        entityType: 'child',
        entityId: updated.id,
        action: AuditAction.RESTORE,
        userId: user.id,
        deviceId,
        oldValues: toAuditJson(this.plainChild(existing)),
        newValues: toAuditJson(this.plainChild(updated)),
        changedAt: now,
      });

      return updated;
    });

    return childMapper.toDetailDto(child as ChildWithRelations);
  }

  async softDelete(
    user: AuthUser,
    id: string,
    version: number,
    deviceId?: string,
  ) {
    const existing = await this.getAccessibleChild(user, id);
    const resolvedDeviceId = await this.resolveDeviceId(user, deviceId);
    const now = new Date();

    const child = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.child.updateMany({
        where: {
          id: existing.id,
          version,
          deletedAt: null,
        },
        data: {
          deletedAt: now,
          status: ChildStatus.archived,
          archivedAt: existing.archivedAt ?? now,
          updatedAt: now,
          updatedById: user.id,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: resolvedDeviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'child', () =>
        tx.child.findUnique({
          where: { id: existing.id },
          select: { version: true },
        }),
      );

      const updated = await tx.child.findFirstOrThrow({
        where: { id: existing.id },
        include: this.defaultInclude(),
      });

      await this.writeSyncOperation(tx, {
        deviceId: resolvedDeviceId,
        entityType: 'child',
        entityId: updated.id,
        operation: PrismaAuditAction.delete,
        payload: { id: updated.id, deletedAt: now },
      });

      await this.audit.log({
        tx,
        entityType: 'child',
        entityId: updated.id,
        action: AuditAction.DELETE,
        userId: user.id,
        deviceId: resolvedDeviceId,
        oldValues: toAuditJson(this.plainChild(existing)),
        newValues: toAuditJson(this.plainChild(updated)),
        changedAt: now,
      });

      return updated;
    });

    return childMapper.toDetailDto(child as ChildWithRelations);
  }

  private plainChild(
    child: ChildWithRelations | Record<string, unknown>,
  ): Record<string, unknown> {
    const { center: _center, homeVillage: _homeVillage, ...plain } =
      child as ChildWithRelations & Record<string, unknown>;
    return plain;
  }

  private async getAccessibleChild(
    user: AuthUser,
    id: string,
  ): Promise<ChildWithRelations> {
    const scope = await this.syncAccess.resolveScope(user);
    const child = await this.prisma.child.findFirst({
      where: {
        id,
        deletedAt: null,
        ...this.syncAccess.centerFilter(scope),
      },
      include: this.defaultInclude(),
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    return child as ChildWithRelations;
  }

  private async assertCenterAccess(
    scope: AccessScope,
    centerId: string,
    user: AuthUser,
  ): Promise<void> {
    if (scope.centerIds === 'all') {
      return;
    }

    if (!scope.centerIds.includes(centerId)) {
      throw new ForbiddenException(
        `You do not have access to center ${centerId} (${user.role})`,
      );
    }
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

  private async writeSyncOperation(
    tx: Prisma.TransactionClient,
    input: {
      deviceId: string | null;
      entityType: string;
      entityId: string;
      operation: PrismaAuditAction;
      payload: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    if (!input.deviceId) {
      return;
    }

    await tx.syncOperation.create({
      data: {
        id: randomUUID(),
        deviceId: input.deviceId,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation,
        payload: input.payload,
        status: SyncOperationStatus.applied,
        clientTimestamp: new Date(),
        processedAt: new Date(),
      },
    });
  }

  private defaultInclude() {
    return {
      classroom: {
        select: { id: true, grade: true },
      },
      center: {
        select: {
          id: true,
          code: true,
          name: true,
          districtId: true,
          district: {
            select: {
              name: true,
              province: { select: { name: true } },
            },
          },
        },
      },
      homeVillage: {
        select: {
          id: true,
          name: true,
          code: true,
          level: true,
          parent: {
            select: {
              id: true,
              name: true,
              level: true,
              parent: {
                select: {
                  id: true,
                  name: true,
                  level: true,
                  district: {
                    select: {
                      name: true,
                      province: { select: { name: true } },
                    },
                  },
                  parent: {
                    select: {
                      id: true,
                      name: true,
                      level: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }
}
