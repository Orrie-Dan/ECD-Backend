import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordSyncStatus, UserRole } from '@prisma/client';
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
  CreateStaffTrainingDto,
  PaginatedStaffTrainingsResponseDto,
  StaffTrainingResponseDto,
  UpdateStaffTrainingDto,
} from './dto/staff-training.dto';

type TrainingRow = Prisma.StaffTrainingGetPayload<{
  include: { center: { select: { id: true; name: true; districtId: true } } };
}>;

@Injectable()
export class StaffTrainingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CenterRegisterAccessService,
  ) {}

  async list(
    user: AuthUser,
    query: ListCenterRegisterQueryDto,
  ): Promise<PaginatedStaffTrainingsResponseDto> {
    const { page, pageSize, skip } = paginationOf(query);
    const where = buildCenterScopedWhere(
      user,
      query,
      'trainingDate',
    ) as Prisma.StaffTrainingWhereInput;
    if (user.role === UserRole.caregiver) {
      where.traineeUserId = user.id;
    } else if (query.traineeUserId) {
      where.traineeUserId = query.traineeUserId;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.staffTraining.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ trainingDate: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.staffTraining.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async get(user: AuthUser, id: string): Promise<StaffTrainingResponseDto> {
    const row = await this.requireRow(id);
    assertCenterAccess(user, row.centerId, row.center.districtId);
    if (user.role === UserRole.caregiver && row.traineeUserId !== user.id) {
      throw new ForbiddenException('You can only view your own training records');
    }
    return this.toDto(row);
  }

  async create(user: AuthUser, dto: CreateStaffTrainingDto): Promise<StaffTrainingResponseDto> {
    const center = await this.access.requireCenter(dto.centerId);
    assertWriteCenterAccess(user, center);
    this.assertDuration(dto.durationDays);
    if (dto.traineeUserId) {
      await this.requireTraineeAtCenter(dto.traineeUserId, dto.centerId);
    }
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.staffTraining.create({
        data: {
          centerId: dto.centerId,
          traineeUserId: dto.traineeUserId ?? null,
          traineeName: dto.traineeName.trim(),
          traineeRole: dto.traineeRole.trim(),
          trainingDate: new Date(dto.trainingDate),
          trainingProvider: dto.trainingProvider.trim(),
          topic: dto.topic.trim(),
          durationDays: dto.durationDays,
          certificateReceived: dto.certificateReceived,
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
        entityType: 'staff_training',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: row.centerId,
          traineeUserId: row.traineeUserId,
          durationDays: row.durationDays,
          certificateReceived: row.certificateReceived,
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
    dto: UpdateStaffTrainingDto,
  ): Promise<StaffTrainingResponseDto> {
    const existing = await this.requireRow(id);
    assertWriteCenterAccess(user, existing.center);
    if (dto.durationDays !== undefined) {
      this.assertDuration(dto.durationDays);
    }
    if (dto.traineeUserId) {
      await this.requireTraineeAtCenter(dto.traineeUserId, existing.centerId);
    }
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.staffTraining.updateMany({
        where: { id: existing.id, version: dto.version, deletedAt: null },
        data: {
          ...(dto.traineeUserId !== undefined && {
            traineeUserId: dto.traineeUserId,
          }),
          ...(dto.traineeName !== undefined && {
            traineeName: dto.traineeName.trim(),
          }),
          ...(dto.traineeRole !== undefined && {
            traineeRole: dto.traineeRole.trim(),
          }),
          ...(dto.trainingProvider !== undefined && {
            trainingProvider: dto.trainingProvider.trim(),
          }),
          ...(dto.topic !== undefined && { topic: dto.topic.trim() }),
          ...(dto.durationDays !== undefined && {
            durationDays: dto.durationDays,
          }),
          ...(dto.certificateReceived !== undefined && {
            certificateReceived: dto.certificateReceived,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          version: { increment: 1 },
          updatedAt: now,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'staff_training', () =>
        tx.staffTraining.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const row = await tx.staffTraining.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'staff_training',
        entityId: row.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues: toAuditJson({
          durationDays: existing.durationDays,
          certificateReceived: existing.certificateReceived,
          version: existing.version,
        }),
        newValues: toAuditJson({
          durationDays: row.durationDays,
          certificateReceived: row.certificateReceived,
          version: row.version,
        }),
        metadata: { source: 'rest' },
      });

      return this.toDto(row);
    });
  }

  private assertDuration(durationDays: number): void {
    if (!Number.isInteger(durationDays) || durationDays < 1) {
      throw new BadRequestException('durationDays must be a positive integer');
    }
  }

  private async requireTraineeAtCenter(traineeUserId: string, centerId: string): Promise<void> {
    const trainee = await this.prisma.userAccount.findFirst({
      where: { id: traineeUserId },
      select: { id: true, centerId: true },
    });
    if (!trainee) {
      throw new NotFoundException('Trainee user not found');
    }
    if (trainee.centerId !== centerId) {
      throw new BadRequestException('Trainee user is not assigned to this center');
    }
  }

  private async requireRow(id: string): Promise<TrainingRow> {
    const row = await this.prisma.staffTraining.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Staff training not found');
    }
    return row;
  }

  private toDto(row: TrainingRow): StaffTrainingResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      traineeUserId: row.traineeUserId,
      traineeName: row.traineeName,
      traineeRole: row.traineeRole,
      trainingDate: row.trainingDate,
      trainingProvider: row.trainingProvider,
      topic: row.topic,
      durationDays: row.durationDays,
      certificateReceived: row.certificateReceived,
      notes: row.notes,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
