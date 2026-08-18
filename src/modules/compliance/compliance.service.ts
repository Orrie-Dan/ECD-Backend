import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssessmentStatus,
  AssessmentType,
  ComplianceClassification,
  GapSeverity,
  GapStatus,
  ItemResponse,
  Prisma,
  RecordSyncStatus,
  StandardDomain,
  UserRole,
} from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess, isCenterStaffRole } from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  AssessmentDetailResponseDto,
  AssessmentItemResponseDto,
  AssessmentResponseDto,
  PaginatedAssessmentsResponseDto,
  StandardResponseDto,
} from './dto/compliance-response.dto';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { CreateAssessmentItemDto } from './dto/create-assessment-item.dto';
import { ListAssessmentsQueryDto } from './dto/list-assessments-query.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { UpdateAssessmentItemDto } from './dto/update-assessment-item.dto';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listAssessments(
    user: AuthUser,
    query: ListAssessmentsQueryDto,
  ): Promise<PaginatedAssessmentsResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where = this.buildListWhere(user, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.complianceAssessment.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ assessmentDate: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.complianceAssessment.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toAssessmentDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async getAssessment(
    user: AuthUser,
    id: string,
  ): Promise<AssessmentDetailResponseDto> {
    const assessment = await this.prisma.complianceAssessment.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
        items: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }],
        },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    assertCenterAccess(user, assessment.centerId, assessment.center.districtId);

    return {
      ...this.toAssessmentDto(assessment),
      items: assessment.items.map((item) => this.toItemDto(item)),
    };
  }

  async createAssessment(
    user: AuthUser,
    dto: CreateAssessmentDto,
  ): Promise<AssessmentResponseDto> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: dto.centerId, deletedAt: null },
      select: { id: true, name: true, districtId: true },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    assertCenterAccess(user, center.id, center.districtId);

    const now = new Date();
    const assessmentDate = new Date(dto.assessmentDate);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.complianceAssessment.create({
        data: {
          centerId: dto.centerId,
          standardsVersion: dto.standardsVersion,
          assessmentType: dto.assessmentType,
          assessmentDate,
          status: AssessmentStatus.draft,
          createdAt: now,
          updatedAt: now,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'compliance_assessment',
        entityId: created.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: created.centerId,
          standardsVersion: created.standardsVersion,
          assessmentType: created.assessmentType,
          assessmentDate: created.assessmentDate,
          status: created.status,
          version: created.version,
        }),
        metadata: { source: 'rest' },
      });

      return created;
    });

    return this.toAssessmentDto({
      ...result,
      center,
    });
  }

  async updateAssessment(
    user: AuthUser,
    id: string,
    dto: UpdateAssessmentDto,
  ): Promise<AssessmentResponseDto> {
    const existing = await this.prisma.complianceAssessment.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('Assessment not found');
    }

    assertCenterAccess(user, existing.centerId, existing.center.districtId);

    if (dto.status) {
      this.validateStatusTransition(existing.status, dto.status);
    }

    const now = new Date();
    const oldValues = toAuditJson({
      status: existing.status,
      submittedById: existing.submittedById,
      submittedAt: existing.submittedAt,
      verifiedById: existing.verifiedById,
      verifiedAt: existing.verifiedAt,
      version: existing.version,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.complianceAssessment.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data: {
          ...(dto.status != null && { status: dto.status }),
          ...(dto.status === AssessmentStatus.submitted && {
            submittedById: user.id,
            submittedAt: now,
          }),
          ...(dto.status === AssessmentStatus.verified && {
            verifiedById: user.id,
            verifiedAt: now,
          }),
          updatedAt: now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'compliance_assessment', () =>
        tx.complianceAssessment.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const updated = await tx.complianceAssessment.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'compliance_assessment',
        entityId: updated.id,
        action:
          dto.status != null && dto.status !== existing.status
            ? AuditAction.STATUS_CHANGE
            : AuditAction.UPDATE,
        userId: user.id,
        oldValues,
        newValues: toAuditJson({
          status: updated.status,
          submittedById: updated.submittedById,
          submittedAt: updated.submittedAt,
          verifiedById: updated.verifiedById,
          verifiedAt: updated.verifiedAt,
          version: updated.version,
        }),
        metadata: { source: 'rest' },
      });

      return updated;
    });

    return this.toAssessmentDto(result);
  }

  async listStandards(): Promise<StandardResponseDto[]> {
    const rows = await this.prisma.ecdStandard.findMany({
      where: { isActive: true },
      orderBy: [{ domain: 'asc' }, { code: 'asc' }],
    });

    return rows.map((row) => this.toStandardDto(row));
  }

  async createAssessmentItem(
    user: AuthUser,
    assessmentId: string,
    dto: CreateAssessmentItemDto,
  ): Promise<AssessmentItemResponseDto> {
    const assessment = await this.prisma.complianceAssessment.findFirst({
      where: { id: assessmentId, deletedAt: null },
      include: {
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    assertCenterAccess(user, assessment.centerId, assessment.center.districtId);

    if (assessment.status !== AssessmentStatus.draft) {
      throw new BadRequestException(
        'Can only add items to draft assessments',
      );
    }

    const standard = await this.prisma.ecdStandard.findFirst({
      where: { id: dto.standardId, isActive: true },
      select: { id: true },
    });

    if (!standard) {
      throw new NotFoundException('Standard not found');
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.complianceAssessmentItem.create({
        data: {
          assessmentId,
          standardId: dto.standardId,
          response: dto.response,
          score: dto.score != null ? new Prisma.Decimal(dto.score) : null,
          evidenceNotes: dto.evidenceNotes ?? null,
          gapSeverity: dto.gapSeverity ?? null,
          gapImprovementAction: dto.gapImprovementAction ?? null,
          gapTargetDate: dto.gapTargetDate ? new Date(dto.gapTargetDate) : null,
          gapStatus: dto.gapStatus ?? null,
          gapResolvedAt: dto.gapResolvedAt ? new Date(dto.gapResolvedAt) : null,
          createdAt: now,
          updatedAt: now,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'compliance_assessment_item',
        entityId: created.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          assessmentId: created.assessmentId,
          standardId: created.standardId,
          response: created.response,
          score: created.score,
          version: created.version,
        }),
        metadata: { source: 'rest' },
      });

      return created;
    });

    return this.toItemDto(result);
  }

  async updateAssessmentItem(
    user: AuthUser,
    assessmentId: string,
    itemId: string,
    dto: UpdateAssessmentItemDto,
  ): Promise<AssessmentItemResponseDto> {
    const assessment = await this.prisma.complianceAssessment.findFirst({
      where: { id: assessmentId, deletedAt: null },
      include: {
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    assertCenterAccess(user, assessment.centerId, assessment.center.districtId);

    const existing = await this.prisma.complianceAssessmentItem.findFirst({
      where: { id: itemId, assessmentId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Assessment item not found');
    }

    const now = new Date();
    const oldValues = toAuditJson({
      response: existing.response,
      score: existing.score,
      evidenceNotes: existing.evidenceNotes,
      gapSeverity: existing.gapSeverity,
      gapStatus: existing.gapStatus,
      version: existing.version,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.complianceAssessmentItem.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data: {
          ...(dto.response != null && { response: dto.response }),
          ...(dto.score !== undefined && {
            score: dto.score != null ? new Prisma.Decimal(dto.score) : null,
          }),
          ...(dto.evidenceNotes !== undefined && {
            evidenceNotes: dto.evidenceNotes ?? null,
          }),
          ...(dto.gapSeverity !== undefined && {
            gapSeverity: dto.gapSeverity ?? null,
          }),
          ...(dto.gapImprovementAction !== undefined && {
            gapImprovementAction: dto.gapImprovementAction ?? null,
          }),
          ...(dto.gapTargetDate !== undefined && {
            gapTargetDate: dto.gapTargetDate
              ? new Date(dto.gapTargetDate)
              : null,
          }),
          ...(dto.gapStatus !== undefined && {
            gapStatus: dto.gapStatus ?? null,
          }),
          ...(dto.gapResolvedAt !== undefined && {
            gapResolvedAt: dto.gapResolvedAt
              ? new Date(dto.gapResolvedAt)
              : null,
          }),
          updatedAt: now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'compliance_assessment_item', () =>
        tx.complianceAssessmentItem.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const updated = await tx.complianceAssessmentItem.findUniqueOrThrow({
        where: { id: existing.id },
      });

      await this.audit.log({
        tx,
        entityType: 'compliance_assessment_item',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues,
        newValues: toAuditJson({
          response: updated.response,
          score: updated.score,
          evidenceNotes: updated.evidenceNotes,
          gapSeverity: updated.gapSeverity,
          gapStatus: updated.gapStatus,
          version: updated.version,
        }),
        metadata: { source: 'rest' },
      });

      return updated;
    });

    return this.toItemDto(result);
  }

  private buildListWhere(
    user: AuthUser,
    query: ListAssessmentsQueryDto,
  ): Prisma.ComplianceAssessmentWhereInput {
    const where: Prisma.ComplianceAssessmentWhereInput = {
      deletedAt: null,
    };

    if (isCenterStaffRole(user.role)) {
      if (!user.centerId) {
        throw new ForbiddenException('Center scope is required for this role');
      }
      where.centerId = user.centerId;
    } else if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException(
          'District scope is required for district focal persons',
        );
      }
      if (query.districtId && query.districtId !== user.districtId) {
        throw new ForbiddenException('Access to other districts is denied');
      }
      where.center = { districtId: user.districtId };
    } else if (user.role === UserRole.ncda_admin) {
      if (query.districtId) {
        where.center = { districtId: query.districtId };
      }
    }

    if (query.centerId) {
      where.centerId = query.centerId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.from || query.to) {
      where.assessmentDate = {};
      if (query.from) {
        where.assessmentDate.gte = new Date(query.from);
      }
      if (query.to) {
        where.assessmentDate.lte = new Date(query.to);
      }
    }

    return where;
  }

  private validateStatusTransition(
    current: AssessmentStatus,
    next: AssessmentStatus,
  ): void {
    const validTransitions: Record<AssessmentStatus, AssessmentStatus[]> = {
      [AssessmentStatus.draft]: [AssessmentStatus.submitted],
      [AssessmentStatus.submitted]: [
        AssessmentStatus.verified,
        AssessmentStatus.rejected,
      ],
      [AssessmentStatus.verified]: [],
      [AssessmentStatus.rejected]: [AssessmentStatus.submitted],
    };

    if (!validTransitions[current]?.includes(next)) {
      throw new BadRequestException(
        `Invalid status transition from ${current} to ${next}`,
      );
    }
  }

  private toAssessmentDto(row: {
    id: string;
    centerId: string;
    standardsVersion: string;
    assessmentType: AssessmentType;
    assessmentDate: Date;
    status: AssessmentStatus;
    submittedById: string | null;
    submittedAt: Date | null;
    verifiedById: string | null;
    verifiedAt: Date | null;
    overallClassification: ComplianceClassification | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    center: { id: string; name: string; districtId: string };
  }): AssessmentResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      standardsVersion: row.standardsVersion,
      assessmentType: row.assessmentType,
      assessmentDate: row.assessmentDate,
      status: row.status,
      submittedById: row.submittedById,
      submittedAt: row.submittedAt,
      verifiedById: row.verifiedById,
      verifiedAt: row.verifiedAt,
      overallClassification: row.overallClassification,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toItemDto(row: {
    id: string;
    assessmentId: string;
    standardId: string;
    response: ItemResponse;
    score: Prisma.Decimal | null;
    evidenceNotes: string | null;
    gapSeverity: GapSeverity | null;
    gapImprovementAction: string | null;
    gapTargetDate: Date | null;
    gapStatus: GapStatus | null;
    gapResolvedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): AssessmentItemResponseDto {
    return {
      id: row.id,
      assessmentId: row.assessmentId,
      standardId: row.standardId,
      response: row.response,
      score: row.score ? row.score.toNumber() : null,
      evidenceNotes: row.evidenceNotes,
      gapSeverity: row.gapSeverity,
      gapImprovementAction: row.gapImprovementAction,
      gapTargetDate: row.gapTargetDate,
      gapStatus: row.gapStatus,
      gapResolvedAt: row.gapResolvedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toStandardDto(row: {
    id: string;
    domain: StandardDomain;
    code: string;
    title: string;
    description: string | null;
    weight: Prisma.Decimal | null;
    version: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): StandardResponseDto {
    return {
      id: row.id,
      domain: row.domain,
      code: row.code,
      title: row.title,
      description: row.description,
      weight: row.weight ? row.weight.toNumber() : null,
      version: row.version,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
