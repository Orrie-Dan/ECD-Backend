import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';
import {
  CreateParentingSessionDto,
  PaginatedParentingSessionsResponseDto,
  ParentingSessionResponseDto,
  UpdateParentingSessionDto,
} from './dto/parenting-session.dto';

type SessionRow = Prisma.ParentingSessionGetPayload<{
  include: { center: { select: { id: true; name: true; districtId: true } } };
}>;

@Injectable()
export class ParentingSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CenterRegisterAccessService,
  ) {}

  async list(
    user: AuthUser,
    query: ListCenterRegisterQueryDto,
  ): Promise<PaginatedParentingSessionsResponseDto> {
    const { page, pageSize, skip } = paginationOf(query);
    const where = buildCenterScopedWhere(
      user,
      query,
      'sessionDate',
    ) as Prisma.ParentingSessionWhereInput;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.parentingSession.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ sessionDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.parentingSession.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async get(user: AuthUser, id: string): Promise<ParentingSessionResponseDto> {
    const row = await this.requireRow(id);
    assertCenterAccess(user, row.centerId, row.center.districtId);
    return this.toDto(row);
  }

  async create(
    user: AuthUser,
    dto: CreateParentingSessionDto,
  ): Promise<ParentingSessionResponseDto> {
    const center = await this.access.requireCenter(dto.centerId);
    assertWriteCenterAccess(user, center);
    this.assertAttendees(dto.maleAttendees, dto.femaleAttendees);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.parentingSession.create({
        data: {
          centerId: dto.centerId,
          sessionDate: new Date(dto.sessionDate),
          topic: dto.topic.trim(),
          facilitatorName: dto.facilitatorName.trim(),
          facilitatorRole: dto.facilitatorRole?.trim() || null,
          facilitatorUserId: dto.facilitatorUserId ?? null,
          messageSummary: dto.messageSummary.trim(),
          maleAttendees: dto.maleAttendees,
          femaleAttendees: dto.femaleAttendees,
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
        entityType: 'parenting_session',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: row.centerId,
          topic: row.topic,
          maleAttendees: row.maleAttendees,
          femaleAttendees: row.femaleAttendees,
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
    dto: UpdateParentingSessionDto,
  ): Promise<ParentingSessionResponseDto> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);
    this.assertAttendees(
      dto.maleAttendees ?? existing.maleAttendees,
      dto.femaleAttendees ?? existing.femaleAttendees,
    );
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.parentingSession.updateMany({
        where: { id: existing.id, version: dto.version, deletedAt: null },
        data: {
          ...(dto.topic !== undefined && { topic: dto.topic.trim() }),
          ...(dto.facilitatorName !== undefined && {
            facilitatorName: dto.facilitatorName.trim(),
          }),
          ...(dto.facilitatorRole !== undefined && {
            facilitatorRole: dto.facilitatorRole?.trim() || null,
          }),
          ...(dto.facilitatorUserId !== undefined && {
            facilitatorUserId: dto.facilitatorUserId,
          }),
          ...(dto.messageSummary !== undefined && {
            messageSummary: dto.messageSummary.trim(),
          }),
          ...(dto.maleAttendees !== undefined && {
            maleAttendees: dto.maleAttendees,
          }),
          ...(dto.femaleAttendees !== undefined && {
            femaleAttendees: dto.femaleAttendees,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          version: { increment: 1 },
          updatedAt: now,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'parenting_session', () =>
        tx.parentingSession.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const row = await tx.parentingSession.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'parenting_session',
        entityId: row.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues: toAuditJson({
          maleAttendees: existing.maleAttendees,
          femaleAttendees: existing.femaleAttendees,
          version: existing.version,
        }),
        newValues: toAuditJson({
          maleAttendees: row.maleAttendees,
          femaleAttendees: row.femaleAttendees,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return this.toDto(row);
    });
  }

  private assertAttendees(maleAttendees: number, femaleAttendees: number): void {
    if (
      !Number.isInteger(maleAttendees) ||
      !Number.isInteger(femaleAttendees) ||
      maleAttendees < 0 ||
      femaleAttendees < 0
    ) {
      throw new BadRequestException('Attendee counts must be non-negative integers');
    }
  }

  private async requireRow(id: string): Promise<SessionRow> {
    const row = await this.prisma.parentingSession.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Parenting session not found');
    }
    return row;
  }

  private toDto(row: SessionRow): ParentingSessionResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      sessionDate: row.sessionDate,
      topic: row.topic,
      facilitatorName: row.facilitatorName,
      facilitatorRole: row.facilitatorRole,
      facilitatorUserId: row.facilitatorUserId,
      messageSummary: row.messageSummary,
      maleAttendees: row.maleAttendees,
      femaleAttendees: row.femaleAttendees,
      totalAttendees: row.maleAttendees + row.femaleAttendees,
      notes: row.notes,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
