import { Injectable, NotFoundException } from '@nestjs/common';
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
  CommitteeMemberResponseDto,
  CreateCommitteeMemberDto,
  DeactivateCommitteeMemberDto,
  PaginatedCommitteeMembersResponseDto,
  UpdateCommitteeMemberDto,
} from './dto/committee-member.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';

type MemberRow = Prisma.EcdCommitteeMemberGetPayload<{
  include: { center: { select: { id: true; name: true; districtId: true } } };
}>;

@Injectable()
export class CommitteeMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CenterRegisterAccessService,
  ) {}

  async list(
    user: AuthUser,
    query: ListCenterRegisterQueryDto,
  ): Promise<PaginatedCommitteeMembersResponseDto> {
    const { page, pageSize, skip } = paginationOf(query);
    const where = buildCenterScopedWhere(
      user,
      query,
      'startDate',
    ) as Prisma.EcdCommitteeMemberWhereInput;

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ecdCommitteeMember.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.ecdCommitteeMember.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async get(user: AuthUser, id: string): Promise<CommitteeMemberResponseDto> {
    const row = await this.requireRow(id);
    assertCenterAccess(user, row.centerId, row.center.districtId);
    return this.toDto(row);
  }

  async create(user: AuthUser, dto: CreateCommitteeMemberDto): Promise<CommitteeMemberResponseDto> {
    const center = await this.access.requireCenter(dto.centerId);
    assertWriteCenterAccess(user, center);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.ecdCommitteeMember.create({
        data: {
          centerId: dto.centerId,
          userId: dto.userId ?? null,
          fullName: dto.fullName.trim(),
          position: dto.position.trim(),
          phone: dto.phone?.trim() || null,
          startDate: dto.startDate ? new Date(dto.startDate) : now,
          endDate: null,
          isActive: true,
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
        entityType: 'ecd_committee_member',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: row.centerId,
          fullName: row.fullName,
          position: row.position,
          isActive: row.isActive,
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
    dto: UpdateCommitteeMemberDto,
  ): Promise<CommitteeMemberResponseDto> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);
    const now = new Date();

    return this.applyCasUpdate(
      user,
      existing,
      dto.version,
      {
        ...(dto.fullName !== undefined && { fullName: dto.fullName.trim() }),
        ...(dto.position !== undefined && { position: dto.position.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
        ...(dto.startDate !== undefined && {
          startDate: dto.startDate ? new Date(dto.startDate) : null,
        }),
        ...(dto.endDate !== undefined && {
          endDate: dto.endDate ? new Date(dto.endDate) : null,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      now,
    );
  }

  async deactivate(
    user: AuthUser,
    id: string,
    dto: DeactivateCommitteeMemberDto,
  ): Promise<CommitteeMemberResponseDto> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);
    const now = new Date();
    const endDate = dto.endDate ? new Date(dto.endDate) : now;

    return this.applyCasUpdate(
      user,
      existing,
      dto.version,
      {
        isActive: false,
        endDate,
      },
      now,
      AuditAction.STATUS_CHANGE,
    );
  }

  private async applyCasUpdate(
    user: AuthUser,
    existing: MemberRow,
    version: number,
    data: Prisma.EcdCommitteeMemberUpdateManyMutationInput,
    now: Date,
    action: AuditAction = AuditAction.UPDATE,
  ): Promise<CommitteeMemberResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.ecdCommitteeMember.updateMany({
        where: { id: existing.id, version, deletedAt: null },
        data: {
          ...data,
          version: { increment: 1 },
          updatedAt: now,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'ecd_committee_member', () =>
        tx.ecdCommitteeMember.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const row = await tx.ecdCommitteeMember.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'ecd_committee_member',
        entityId: row.id,
        action,
        userId: user.id,
        oldValues: toAuditJson({
          isActive: existing.isActive,
          endDate: existing.endDate,
          version: existing.version,
        }),
        newValues: toAuditJson({
          isActive: row.isActive,
          endDate: row.endDate,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return this.toDto(row);
    });
  }

  private async requireRow(id: string): Promise<MemberRow> {
    const row = await this.prisma.ecdCommitteeMember.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Committee member not found');
    }
    return row;
  }

  private toDto(row: MemberRow): CommitteeMemberResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      userId: row.userId,
      fullName: row.fullName,
      position: row.position,
      phone: row.phone,
      startDate: row.startDate,
      endDate: row.endDate,
      isActive: row.isActive,
      notes: row.notes,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
