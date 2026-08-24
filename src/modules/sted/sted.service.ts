import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus, RecordSyncStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateStedAssessmentDto } from './dto/create-sted-assessment.dto';
import { StedAssessmentResponseDto, StedHistoryResponseDto } from './dto/sted-response.dto';
import { extractStedReferralSignals, stedMapper } from './mappers/sted.mapper';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * STED assessments are append-only clinical records.
 * REST exposes create + read only — no update/delete endpoints.
 * Soft-delete (if ever needed) should use sync CAS; do not add blind REST updates.
 */
@Injectable()
export class StedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: AuthUser, dto: CreateStedAssessmentDto): Promise<StedAssessmentResponseDto> {
    if (!dto.consentObtained) {
      throw new BadRequestException('consentObtained must be true to record a STED assessment');
    }

    const child = await this.getAccessibleChild(user, dto.childId);

    if (child.centerId !== dto.centerId) {
      throw new BadRequestException('centerId does not match the child current center');
    }

    assertCenterAccess(user, dto.centerId, child.center.districtId);

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const mapped = stedMapper.toCreateData(dto);
    const now = new Date();

    // Referral preparation only — do not create Referral rows yet.
    extractStedReferralSignals({
      physicalAssessment: dto.physicalAssessment,
      milestoneResults: dto.milestoneResults,
      outcome: dto.outcome,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.stedAssessment.create({
        data: {
          id: randomUUID(),
          childId: child.id,
          centerId: dto.centerId,
          assessmentDate: new Date(`${dto.assessmentDate.slice(0, 10)}T00:00:00.000Z`),
          ageBand: mapped.ageBand,
          consentObtained: mapped.consentObtained,
          physicalAssessment: mapped.physicalAssessment,
          milestoneResults: mapped.milestoneResults,
          outcome: mapped.outcome,
          followUpIn6Months: mapped.followUpIn6Months,
          followUpDueDate: mapped.followUpDueDate,
          notes: mapped.notes,
          assessedById: user.id,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'sted_assessment',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        deviceId,
        oldValues: null,
        newValues: toAuditJson(row),
        changedAt: now,
      });

      return row;
    });

    if (mapped.followUpIn6Months) {
      this.notifications
        .findUserIdsByRoleAndCenter(dto.centerId, [UserRole.ecd_director, UserRole.caregiver])
        .then((ids) => {
          this.notifications.notifyAsync(ids, {
            type: 'sted_followup',
            title: 'STED follow-up scheduled',
            message: `A STED assessment requires a 6-month follow-up.`,
            entityType: 'sted_assessment',
            entityId: created.id,
          });
        })
        .catch(() => {});
    }

    return stedMapper.toDto(created);
  }

  async getHistory(
    user: AuthUser,
    childId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<StedHistoryResponseDto> {
    await this.getAccessibleChild(user, childId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const skip = (page - 1) * pageSize;
    const where = { childId, deletedAt: null };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stedAssessment.findMany({
        where,
        orderBy: [{ assessmentDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.stedAssessment.count({ where }),
    ]);

    return {
      childId,
      items: rows.map((row) => stedMapper.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async findOne(user: AuthUser, id: string): Promise<StedAssessmentResponseDto> {
    const row = await this.prisma.stedAssessment.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!row) {
      throw new NotFoundException('STED assessment not found');
    }

    assertCenterAccess(user, row.centerId, row.center.districtId);
    return stedMapper.toDto(row);
  }

  private async getAccessibleChild(user: AuthUser, childId: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        centerId: true,
        status: true,
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    assertCenterAccess(user, child.centerId, child.center.districtId);
    return child;
  }

  private async resolveDeviceId(user: AuthUser, deviceId?: string): Promise<string | null> {
    if (!deviceId) {
      return null;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device || device.userId !== user.id) {
      throw new ForbiddenException('Device does not belong to the authenticated user');
    }

    if (device.status !== DeviceStatus.active) {
      throw new ForbiddenException('Device is inactive');
    }

    return device.id;
  }
}
