import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ParentContributionType, Prisma, RecordSyncStatus } from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { LookupDualWrite, LookupResolverService } from '../../common/lookups';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CenterRegisterAccessService } from './center-register-access.service';
import {
  assertCanReadRegisterSummary,
  assertWriteCenterAccess,
  buildCenterScopedWhere,
  paginationOf,
} from './center-register.scope';
import { CreateParentContributionDto } from './dto/create-parent-contribution.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';
import {
  PaginatedParentContributionsResponseDto,
  ParentContributionResponseDto,
  ParentContributionSummaryDto,
} from './dto/parent-contribution-response.dto';
import { UpdateParentContributionDto } from './dto/update-parent-contribution.dto';
import { toNumber, toNumberOrNull } from './register-numbers';

type ContributionRow = Prisma.ParentContributionGetPayload<{
  include: { center: { select: { id: true; name: true; districtId: true } } };
}>;

@Injectable()
export class ParentContributionsService {
  private readonly lookupDw: LookupDualWrite;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CenterRegisterAccessService,
    lookupResolver: LookupResolverService,
  ) {
    this.lookupDw = new LookupDualWrite(lookupResolver);
  }

  async list(
    user: AuthUser,
    query: ListCenterRegisterQueryDto,
  ): Promise<PaginatedParentContributionsResponseDto> {
    const { page, pageSize, skip } = paginationOf(query);
    const where = buildCenterScopedWhere(
      user,
      query,
      'contributionDate',
    ) as Prisma.ParentContributionWhereInput;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.parentContribution.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ contributionDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.parentContribution.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async get(user: AuthUser, id: string): Promise<ParentContributionResponseDto> {
    const row = await this.requireRow(id);
    assertCenterAccess(user, row.centerId, row.center.districtId);
    return this.toDto(row);
  }

  async summary(
    user: AuthUser,
    query: ListCenterRegisterQueryDto,
  ): Promise<ParentContributionSummaryDto> {
    assertCanReadRegisterSummary(user);
    const where = buildCenterScopedWhere(
      user,
      query,
      'contributionDate',
    ) as Prisma.ParentContributionWhereInput;

    const rows = await this.prisma.parentContribution.findMany({
      where,
      select: {
        centerId: true,
        contributionType: true,
        amount: true,
        contributorName: true,
      },
    });

    const cash = rows.filter((r) => r.contributionType === ParentContributionType.cash);
    const inKind = rows.filter((r) => r.contributionType === ParentContributionType.in_kind);

    return {
      centerId: query.centerId ?? user.centerId ?? '',
      from: query.from ?? null,
      to: query.to ?? null,
      cashContributorCount: this.distinctNames(cash.map((r) => r.contributorName)),
      cashAmountTotal: cash.reduce((sum, r) => sum + toNumber(r.amount), 0),
      inKindContributorCount: this.distinctNames(inKind.map((r) => r.contributorName)),
      cashRecordCount: cash.length,
      inKindRecordCount: inKind.length,
    };
  }

  async create(
    user: AuthUser,
    dto: CreateParentContributionDto,
  ): Promise<ParentContributionResponseDto> {
    const center = await this.access.requireCenter(dto.centerId);
    assertWriteCenterAccess(user, center);
    this.assertContributionShape(dto.contributionType, dto.amount, dto.itemType);

    if (dto.childId) {
      await this.access.requireChildInCenter(dto.childId, dto.centerId);
    }

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.parentContribution.create({
        data: {
          centerId: dto.centerId,
          childId: dto.childId ?? null,
          contributorName: dto.contributorName.trim(),
          contributorPhone: dto.contributorPhone?.trim() || null,
          contributionDate: new Date(dto.contributionDate),
          ...this.lookupDw.parentContributionType(dto.contributionType),
          ...(dto.contributionType === ParentContributionType.cash
            ? { amount: dto.amount!, itemType: null, itemTypeId: null }
            : {
                amount: null,
                ...this.lookupDw.optionalInKindItemType(dto.itemType!),
              }),
          quantity: dto.quantity ?? null,
          unit: dto.unit?.trim() || null,
          description: dto.description?.trim() || null,
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
        entityType: 'parent_contribution',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: row.centerId,
          contributionType: row.contributionType,
          amount: toNumberOrNull(row.amount),
          itemType: row.itemType,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return row;
    });

    return this.toDto(created);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateParentContributionDto,
  ): Promise<ParentContributionResponseDto> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);

    const nextType = dto.contributionType ?? existing.contributionType;
    const nextAmount = dto.amount !== undefined ? dto.amount : toNumberOrNull(existing.amount);
    const nextItemType = dto.itemType !== undefined ? dto.itemType : existing.itemType;
    this.assertContributionShape(nextType, nextAmount, nextItemType);

    const now = new Date();
    const oldValues = toAuditJson({
      contributionType: existing.contributionType,
      amount: toNumberOrNull(existing.amount),
      itemType: existing.itemType,
      version: existing.version,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ParentContributionUncheckedUpdateManyInput = {
        ...(dto.contributorName !== undefined && {
          contributorName: dto.contributorName.trim(),
        }),
        ...(dto.contributorPhone !== undefined && {
          contributorPhone: dto.contributorPhone?.trim() || null,
        }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.unit !== undefined && { unit: dto.unit?.trim() || null }),
        ...(dto.description !== undefined && {
          description: dto.description?.trim() || null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(nextType === ParentContributionType.cash ? { itemType: null, itemTypeId: null } : { amount: null }),
        version: { increment: 1 },
        updatedAt: now,
        syncStatus: RecordSyncStatus.synced,
        lastModifiedAt: now,
      };

      if (dto.contributionType !== undefined) {
        Object.assign(data, this.lookupDw.parentContributionType(dto.contributionType));
      }
      if (nextType === ParentContributionType.in_kind && dto.itemType !== undefined) {
        Object.assign(data, this.lookupDw.optionalInKindItemType(dto.itemType));
      }

      const cas = await tx.parentContribution.updateMany({
        where: { id: existing.id, version: dto.version, deletedAt: null },
        data,
      });

      await assertCasApplied(cas.count, 'parent_contribution', () =>
        tx.parentContribution.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const row = await tx.parentContribution.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'parent_contribution',
        entityId: row.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues,
        newValues: toAuditJson({
          contributionType: row.contributionType,
          amount: toNumberOrNull(row.amount),
          itemType: row.itemType,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return row;
    });

    return this.toDto(updated);
  }

  async archive(user: AuthUser, id: string, version: number): Promise<void> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.parentContribution.updateMany({
        where: { id: existing.id, version, deletedAt: null },
        data: {
          deletedAt: now,
          updatedAt: now,
          version: { increment: 1 },
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'parent_contribution', () =>
        tx.parentContribution.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      await this.audit.log({
        tx,
        entityType: 'parent_contribution',
        entityId: existing.id,
        action: AuditAction.ARCHIVE,
        userId: user.id,
        oldValues: toAuditJson({ version: existing.version }),
        newValues: toAuditJson({ deletedAt: now, version: existing.version + 1 }),
        metadata: { source: 'rest' },
      });
    });
  }

  private async requireRow(id: string): Promise<ContributionRow> {
    const row = await this.prisma.parentContribution.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Parent contribution not found');
    }
    return row;
  }

  private assertContributionShape(
    type: ParentContributionType,
    amount: number | null | undefined,
    itemType: string | null | undefined,
  ): void {
    if (type === ParentContributionType.cash) {
      if (amount == null) {
        throw new BadRequestException('Cash contributions require amount');
      }
      if (amount < 0) {
        throw new BadRequestException('Contribution amount cannot be negative');
      }
      if (itemType) {
        throw new BadRequestException('Cash contributions cannot include an in-kind item type');
      }
      return;
    }

    if (!itemType) {
      throw new BadRequestException('In-kind contributions require itemType');
    }
    if (amount != null) {
      throw new BadRequestException('In-kind contributions cannot include a cash amount');
    }
  }

  private distinctNames(names: string[]): number {
    return new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean)).size;
  }

  private toDto(row: ContributionRow): ParentContributionResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      childId: row.childId,
      contributorName: row.contributorName,
      contributorPhone: row.contributorPhone,
      contributionDate: row.contributionDate,
      contributionType: row.contributionType,
      amount: toNumberOrNull(row.amount),
      itemType: row.itemType,
      quantity: toNumberOrNull(row.quantity),
      unit: row.unit,
      description: row.description,
      notes: row.notes,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
