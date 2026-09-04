import { Injectable, NotFoundException } from '@nestjs/common';
import { CenterSupportCategory, asDomainEnum } from '../../common/domain';
import { Prisma, RecordSyncStatus } from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CenterRegisterAccessService } from './center-register-access.service';
import {
  assertWriteCenterAccess,
  buildCenterScopedWhere,
  paginationOf,
} from './center-register.scope';
import {
  CenterSupportResponseDto,
  CreateCenterSupportDto,
  PaginatedCenterSupportResponseDto,
  UpdateCenterSupportDto,
} from './dto/center-support.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';
import { toNumberOrNull } from './register-numbers';

type SupportRow = Prisma.CenterSupportGetPayload<{
  include: { center: { select: { id: true; name: true; districtId: true } } };
}>;

@Injectable()
export class CenterSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CenterRegisterAccessService,
  ) {}

  async list(
    user: AuthUser,
    query: ListCenterRegisterQueryDto,
  ): Promise<PaginatedCenterSupportResponseDto> {
    const { page, pageSize, skip } = paginationOf(query);
    const where = buildCenterScopedWhere(
      user,
      query,
      'receivedDate',
    ) as Prisma.CenterSupportWhereInput;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.centerSupport.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ receivedDate: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.centerSupport.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async get(user: AuthUser, id: string): Promise<CenterSupportResponseDto> {
    const row = await this.requireRow(id);
    assertCenterAccess(user, row.centerId, row.center.districtId);
    return this.toDto(row);
  }

  async create(user: AuthUser, dto: CreateCenterSupportDto): Promise<CenterSupportResponseDto> {
    const center = await this.access.requireCenter(dto.centerId);
    assertWriteCenterAccess(user, center);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.centerSupport.create({
        data: {
          centerId: dto.centerId,
          receivedDate: new Date(dto.receivedDate),
          supportCategory: dto.supportCategory,
          description: dto.description.trim(),
          quantity: dto.quantity ?? null,
          unit: dto.unit?.trim() || null,
          providerName: dto.providerName.trim(),
          providerOrganization: dto.providerOrganization?.trim() || null,
          receivedById: dto.receivedById ?? null,
          receivedByName: dto.receivedByName?.trim() || null,
          notes: dto.notes ?? null,
          recordedById: user.id,
          createdAt: now,
          updatedAt: now,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'center_support',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: row.centerId,
          supportCategory: row.supportCategory,
          providerName: row.providerName,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return this.toDto(row);
    });
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateCenterSupportDto,
  ): Promise<CenterSupportResponseDto> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.CenterSupportUncheckedUpdateManyInput = {
        ...(dto.description !== undefined && {
          description: dto.description.trim(),
        }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.unit !== undefined && { unit: dto.unit?.trim() || null }),
        ...(dto.providerName !== undefined && {
          providerName: dto.providerName.trim(),
        }),
        ...(dto.providerOrganization !== undefined && {
          providerOrganization: dto.providerOrganization?.trim() || null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        version: { increment: 1 },
        updatedAt: now,
        syncStatus: RecordSyncStatus.synced,
        lastModifiedAt: now,
      };

      if (dto.supportCategory !== undefined) {
        data.supportCategory = dto.supportCategory;
      }

      const cas = await tx.centerSupport.updateMany({
        where: { id: existing.id, version: dto.version, deletedAt: null },
        data,
      });

      await assertCasApplied(cas.count, 'center_support', () =>
        tx.centerSupport.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const row = await tx.centerSupport.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'center_support',
        entityId: row.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues: toAuditJson({
          supportCategory: existing.supportCategory,
          version: existing.version,
        }),
        newValues: toAuditJson({
          supportCategory: row.supportCategory,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return this.toDto(row);
    });
  }

  private async requireRow(id: string): Promise<SupportRow> {
    const row = await this.prisma.centerSupport.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Center support record not found');
    }
    return row;
  }

  private toDto(row: SupportRow): CenterSupportResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      receivedDate: row.receivedDate,
      supportCategory: asDomainEnum<CenterSupportCategory>(row.supportCategory),
      description: row.description,
      quantity: toNumberOrNull(row.quantity),
      unit: row.unit,
      providerName: row.providerName,
      providerOrganization: row.providerOrganization,
      receivedById: row.receivedById,
      receivedByName: row.receivedByName,
      notes: row.notes,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
