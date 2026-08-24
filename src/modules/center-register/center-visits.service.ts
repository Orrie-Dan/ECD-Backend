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
  CenterVisitResponseDto,
  CreateCenterVisitDto,
  PaginatedCenterVisitsResponseDto,
  UpdateCenterVisitDto,
} from './dto/center-visit.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';

type VisitRow = Prisma.CenterVisitGetPayload<{
  include: { center: { select: { id: true; name: true; districtId: true } } };
}>;

@Injectable()
export class CenterVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CenterRegisterAccessService,
  ) {}

  async list(
    user: AuthUser,
    query: ListCenterRegisterQueryDto,
  ): Promise<PaginatedCenterVisitsResponseDto> {
    const { page, pageSize, skip } = paginationOf(query);
    const where = buildCenterScopedWhere(user, query, 'visitDate') as Prisma.CenterVisitWhereInput;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.centerVisit.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ visitDate: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.centerVisit.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async get(user: AuthUser, id: string): Promise<CenterVisitResponseDto> {
    const row = await this.requireRow(id);
    assertCenterAccess(user, row.centerId, row.center.districtId);
    return this.toDto(row);
  }

  async create(user: AuthUser, dto: CreateCenterVisitDto): Promise<CenterVisitResponseDto> {
    const center = await this.access.requireCenter(dto.centerId);
    assertWriteCenterAccess(user, center);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.centerVisit.create({
        data: {
          centerId: dto.centerId,
          visitDate: new Date(dto.visitDate),
          visitorName: dto.visitorName.trim(),
          organization: dto.organization?.trim() || null,
          occupationOrRole: dto.occupationOrRole?.trim() || null,
          purposeOrMessage: dto.purposeOrMessage.trim(),
          hostedById: dto.hostedById ?? null,
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
        entityType: 'center_visit',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: row.centerId,
          visitorName: row.visitorName,
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
    dto: UpdateCenterVisitDto,
  ): Promise<CenterVisitResponseDto> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.centerVisit.updateMany({
        where: { id: existing.id, version: dto.version, deletedAt: null },
        data: {
          ...(dto.visitorName !== undefined && {
            visitorName: dto.visitorName.trim(),
          }),
          ...(dto.organization !== undefined && {
            organization: dto.organization?.trim() || null,
          }),
          ...(dto.occupationOrRole !== undefined && {
            occupationOrRole: dto.occupationOrRole?.trim() || null,
          }),
          ...(dto.purposeOrMessage !== undefined && {
            purposeOrMessage: dto.purposeOrMessage.trim(),
          }),
          ...(dto.hostedById !== undefined && { hostedById: dto.hostedById }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          version: { increment: 1 },
          updatedAt: now,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'center_visit', () =>
        tx.centerVisit.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const row = await tx.centerVisit.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'center_visit',
        entityId: row.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues: toAuditJson({
          visitorName: existing.visitorName,
          version: existing.version,
        }),
        newValues: toAuditJson({
          visitorName: row.visitorName,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return this.toDto(row);
    });
  }

  private async requireRow(id: string): Promise<VisitRow> {
    const row = await this.prisma.centerVisit.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Center visit not found');
    }
    return row;
  }

  private toDto(row: VisitRow): CenterVisitResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      visitDate: row.visitDate,
      visitorName: row.visitorName,
      organization: row.organization,
      occupationOrRole: row.occupationOrRole,
      purposeOrMessage: row.purposeOrMessage,
      hostedById: row.hostedById,
      notes: row.notes,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
