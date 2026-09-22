import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { UserRole } from '../../common/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CaregiverWorkExperienceListResponseDto,
  CaregiverWorkExperienceResponseDto,
  CreateCaregiverWorkExperienceDto,
  UpdateCaregiverWorkExperienceDto,
} from './dto/caregiver-work-experience.dto';
import { UsersService } from './users.service';

type ExperienceRow = {
  id: string;
  userId: string;
  employer: string;
  jobTitle: string;
  startDate: Date;
  endDate: Date | null;
  description: string | null;
  recordedById: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class CaregiverWorkExperiencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  async listForUser(
    actor: AuthUser,
    userId: string,
  ): Promise<CaregiverWorkExperienceListResponseDto> {
    const target = await this.users.requireVisibleUser(actor, userId);
    this.assertCaregiverTarget(target.role);

    const rows = await this.prisma.caregiverWorkExperience.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    return { items: rows.map((row) => this.toDto(row)) };
  }

  async createForUser(
    actor: AuthUser,
    userId: string,
    dto: CreateCaregiverWorkExperienceDto,
  ): Promise<CaregiverWorkExperienceResponseDto> {
    const target = await this.users.requireVisibleUser(actor, userId);
    this.assertCaregiverTarget(target.role);
    this.assertDateRange(dto.startDate, dto.endDate);

    return this.prisma.$transaction(async (tx) => {
      const row = await this.insertOne(tx, {
        actorId: actor.id,
        userId,
        dto,
      });
      return this.toDto(row);
    });
  }

  async update(
    actor: AuthUser,
    userId: string,
    experienceId: string,
    dto: UpdateCaregiverWorkExperienceDto,
  ): Promise<CaregiverWorkExperienceResponseDto> {
    const target = await this.users.requireVisibleUser(actor, userId);
    this.assertCaregiverTarget(target.role);

    const existing = await this.prisma.caregiverWorkExperience.findFirst({
      where: { id: experienceId, userId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Work experience not found');
    }

    const nextStart = dto.startDate ?? existing.startDate.toISOString().slice(0, 10);
    const nextEnd =
      dto.endDate !== undefined
        ? dto.endDate
        : existing.endDate
          ? existing.endDate.toISOString().slice(0, 10)
          : null;
    this.assertDateRange(nextStart, nextEnd);

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.caregiverWorkExperience.updateMany({
        where: { id: existing.id, version: dto.version, deletedAt: null },
        data: {
          ...(dto.employer !== undefined && { employer: dto.employer.trim() }),
          ...(dto.jobTitle !== undefined && { jobTitle: dto.jobTitle.trim() }),
          ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
          ...(dto.endDate !== undefined && {
            endDate: dto.endDate ? new Date(dto.endDate) : null,
          }),
          ...(dto.description !== undefined && { description: dto.description }),
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'caregiver_work_experience', () =>
        tx.caregiverWorkExperience.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const row = await tx.caregiverWorkExperience.findUniqueOrThrow({
        where: { id: existing.id },
      });

      await this.audit.log({
        tx,
        entityType: 'caregiver_work_experience',
        entityId: row.id,
        action: AuditAction.UPDATE,
        userId: actor.id,
        oldValues: toAuditJson({
          employer: existing.employer,
          jobTitle: existing.jobTitle,
          version: existing.version,
        }),
        newValues: toAuditJson({
          employer: row.employer,
          jobTitle: row.jobTitle,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return this.toDto(row);
    });
  }

  /** Used by UsersService.create nested transaction. */
  async insertOne(
    tx: Prisma.TransactionClient,
    args: {
      actorId: string;
      userId: string;
      dto: CreateCaregiverWorkExperienceDto;
    },
  ): Promise<ExperienceRow> {
    this.assertDateRange(args.dto.startDate, args.dto.endDate);
    const now = new Date();
    const row = await tx.caregiverWorkExperience.create({
      data: {
        userId: args.userId,
        employer: args.dto.employer.trim(),
        jobTitle: args.dto.jobTitle.trim(),
        startDate: new Date(args.dto.startDate),
        endDate: args.dto.endDate ? new Date(args.dto.endDate) : null,
        description: args.dto.description?.trim() || null,
        recordedById: args.actorId,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
    });

    await this.audit.log({
      tx,
      entityType: 'caregiver_work_experience',
      entityId: row.id,
      action: AuditAction.CREATE,
      userId: args.actorId,
      oldValues: null,
      newValues: toAuditJson({
        userId: row.userId,
        employer: row.employer,
        jobTitle: row.jobTitle,
        version: row.version,
      }),
      metadata: { source: 'rest' },
    });

    return row;
  }

  private assertCaregiverTarget(role: string): void {
    if (role !== UserRole.caregiver) {
      throw new BadRequestException('Work experience is only supported for caregivers');
    }
  }

  private assertDateRange(startDate: string, endDate?: string | null): void {
    if (!endDate) return;
    if (new Date(endDate) < new Date(startDate)) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }

  private toDto(row: ExperienceRow): CaregiverWorkExperienceResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      employer: row.employer,
      jobTitle: row.jobTitle,
      startDate: row.startDate,
      endDate: row.endDate,
      description: row.description,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
