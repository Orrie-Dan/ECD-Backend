import {
  AssessmentStatus,
  AssessmentType,
  GapSeverity,
  GapStatus,
  ItemResponse,
  StandardDomain,
  UserRole,
  asDomainEnum,
  asDomainEnumNullable,
} from '../../common/domain';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ComplianceClassification, Prisma, RecordSyncStatus } from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess, isCenterAdminRole, isCenterStaffRole, isDistrictPortalRole } from '../../common/auth/scope.util';
import {
  assertCenterAccessible,
  centerOwnedListFilter,
} from '../../common/scope/district-query.scope';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  AssessmentDetailResponseDto,
  AssessmentItemResponseDto,
  AssessmentResponseDto,
  PaginatedAssessmentsResponseDto,
  SelfEvalDraftEnvelopeDto,
  StandardResponseDto,
} from './dto/compliance-response.dto';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { CreateAssessmentItemDto } from './dto/create-assessment-item.dto';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { ListAssessmentsQueryDto } from './dto/list-assessments-query.dto';
import { SaveInspectionDraftDto } from './dto/save-inspection-draft.dto';
import { SaveSelfEvaluationDraftDto } from './dto/save-self-evaluation-draft.dto';
import { SubmitInspectionDto } from './dto/submit-inspection.dto';
import { SubmitSelfEvaluationDto } from './dto/submit-self-evaluation.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { UpdateAssessmentItemDto } from './dto/update-assessment-item.dto';
import { NotificationEventsService } from '../notifications/notification-events.service';
import {
  SELF_EVAL_SCORE_CODE,
  encodeSelfEvalStandardsVersion,
  getFacilityChecklist,
  parseSelfEvalStandardsVersion,
  resolveSelfEvalAnswerItems,
  scoreSelfEvaluationFromAnswers,
} from './self-eval-catalog';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  async listAssessments(
    user: AuthUser,
    query: ListAssessmentsQueryDto,
  ): Promise<PaginatedAssessmentsResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where = await this.buildListWhere(user, query);

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

  async getAssessment(user: AuthUser, id: string): Promise<AssessmentDetailResponseDto> {
    const assessment = await this.prisma.complianceAssessment.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true, villageId: true } },
        items: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }],
          include: {
            standard: { select: { code: true, title: true } },
          },
        },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    await assertCenterAccessible(this.prisma, user, {
      id: assessment.centerId,
      districtId: assessment.center.districtId,
      villageId: assessment.center.villageId,
    });

    return {
      ...this.toAssessmentDto(assessment),
      items: assessment.items.map((item) => this.toItemDto(item)),
    };
  }

  async createAssessment(user: AuthUser, dto: CreateAssessmentDto): Promise<AssessmentResponseDto> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: dto.centerId, deletedAt: null },
      select: { id: true, name: true, districtId: true, villageId: true },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    await assertCenterAccessible(this.prisma, user, center);

    if (
      dto.assessmentType === AssessmentType.self_assessment &&
      isDistrictPortalRole(user.role)
    ) {
      throw new ForbiddenException(
        'Self-evaluations cannot be created via portal assessments; use the ECD director self-evaluation workflow',
      );
    }

    const now = new Date();
    const assessmentDate = new Date(dto.assessmentDate);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.complianceAssessment.create({
        data: {
          centerId: dto.centerId,
          standardsVersion: dto.standardsVersion,
          assessmentDate,
          assessmentType: dto.assessmentType,
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

  /**
   * Center staff: current self-evaluation draft for their center, if any.
   */
  async getSelfEvalDraft(user: AuthUser): Promise<SelfEvalDraftEnvelopeDto> {
    const center = await this.requireCenterStaffCenter(user);
    const draft = await this.findSelfEvalDraftRow(this.prisma, center.id);
    if (!draft) {
      return { draft: null };
    }
    return { draft: this.toAssessmentDetailDto(draft) };
  }

  /**
   * Upsert the center's single self-evaluation draft (partial answers allowed).
   * Does not create a second draft and never mutates submitted assessments.
   */
  async saveSelfEvalDraft(
    user: AuthUser,
    dto: SaveSelfEvaluationDraftDto,
  ): Promise<AssessmentDetailResponseDto> {
    const center = await this.requireCenterStaffCenter(user);
    this.assertKnownChecklist(dto.facilityTypeId, dto.standardsVersion);
    const { resolvedQuestions } = resolveSelfEvalAnswerItems(dto.facilityTypeId, dto.items ?? [], {
      allowEmpty: true,
    });

    const now = new Date();
    const assessmentDate = new Date(dto.assessmentDate);
    const standardsVersion = encodeSelfEvalStandardsVersion(
      dto.standardsVersion,
      dto.facilityTypeId,
    );

    const savedId = await this.prisma.$transaction(async (tx) => {
      const draft = await this.ensureSelfEvalDraftRow(tx, {
        centerId: center.id,
        standardsVersion,
        assessmentDate,
        clientDraftId: dto.clientDraftId,
        userId: user.id,
        now,
      });

      await this.syncSelfEvalAnswerItems(tx, {
        assessmentId: draft.id,
        resolvedQuestions,
        now,
        keepScoreItem: false,
        scoreItem: null,
      });

      await this.audit.log({
        tx,
        entityType: 'compliance_assessment',
        entityId: draft.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          status: AssessmentStatus.draft,
          standardsVersion,
          itemCount: resolvedQuestions.length,
          clientDraftId: dto.clientDraftId ?? draft.clientDraftId,
        }),
        metadata: { source: 'rest', kind: 'self_evaluation_draft_save' },
      });

      return draft.id;
    });

    const reloaded = await this.findSelfEvalDraftRow(this.prisma, center.id);
    if (!reloaded || reloaded.id !== savedId) {
      throw new NotFoundException('Draft not found after save');
    }
    return this.toAssessmentDetailDto(reloaded);
  }

  /**
   * Soft-delete the center's active self-evaluation draft. Submitted history is untouched.
   */
  async deleteSelfEvalDraft(user: AuthUser): Promise<SelfEvalDraftEnvelopeDto> {
    const center = await this.requireCenterStaffCenter(user);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const draft = await this.findSelfEvalDraftRow(tx, center.id);
      if (!draft) {
        return;
      }
      await tx.complianceAssessment.update({
        where: { id: draft.id },
        data: { deletedAt: now, updatedAt: now, lastModifiedAt: now },
      });
      await this.audit.log({
        tx,
        entityType: 'compliance_assessment',
        entityId: draft.id,
        action: AuditAction.DELETE,
        userId: user.id,
        oldValues: toAuditJson({ status: draft.status }),
        newValues: null,
        metadata: { source: 'rest', kind: 'self_evaluation_draft_delete' },
      });
    });

    return { draft: null };
  }

  /**
   * Center staff submit a scored ECD Standards self-evaluation.
   * If a draft exists for the center, it is finalized in place (same id).
   * Otherwise a new submitted assessment is created. Historical submitted
   * assessments are never overwritten.
   */
  async submitSelfEvaluation(
    user: AuthUser,
    dto: SubmitSelfEvaluationDto,
  ): Promise<AssessmentResponseDto> {
    const center = await this.requireCenterStaffCenter(user);

    if (user.centerId !== dto.centerId) {
      throw new ForbiddenException('Cannot submit self-evaluation for another center');
    }

    this.assertKnownChecklist(dto.facilityTypeId, dto.standardsVersion);
    const { answers, resolvedQuestions } = resolveSelfEvalAnswerItems(
      dto.facilityTypeId,
      dto.items,
      { allowEmpty: false },
    );
    this.assertSelfEvalScores(dto, dto.facilityTypeId, answers);

    const classification = this.classificationFromRank(dto.rank);
    const now = new Date();
    const assessmentDate = new Date(dto.assessmentDate);
    const standardsVersion = encodeSelfEvalStandardsVersion(
      dto.standardsVersion,
      dto.facilityTypeId,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const draft = await this.findSelfEvalDraftRow(tx, center.id);
      if (dto.assessmentId) {
        if (!draft || draft.id !== dto.assessmentId) {
          throw new BadRequestException('assessmentId does not match the center active draft');
        }
      }

      const scoreItem = {
        facilityTypeId: dto.facilityTypeId,
        earnedScore: dto.earnedScore,
        maxScore: dto.maxScore,
        percent: dto.percent,
        rank: dto.rank,
        clientDraftId: dto.clientDraftId ?? draft?.clientDraftId ?? null,
      };

      if (draft) {
        const updated = await tx.complianceAssessment.update({
          where: { id: draft.id },
          data: {
            standardsVersion,
            assessmentDate,
            status: AssessmentStatus.submitted,
            submittedById: user.id,
            submittedAt: now,
            overallClassification: classification,
            overallPercent: new Prisma.Decimal(dto.percent),
            overallRank: dto.rank,
            clientDraftId: dto.clientDraftId ?? draft.clientDraftId,
            updatedAt: now,
            lastModifiedAt: now,
            version: { increment: 1 },
            syncStatus: RecordSyncStatus.synced,
          },
        });

        await this.syncSelfEvalAnswerItems(tx, {
          assessmentId: draft.id,
          resolvedQuestions,
          now,
          keepScoreItem: true,
          scoreItem,
          standardsVersion: dto.standardsVersion,
        });

        await tx.ecdCenter.update({
          where: { id: center.id },
          data: {
            currentComplianceLevel: classification,
            currentComplianceAssessedAt: assessmentDate,
            updatedAt: now,
          },
        });

        await this.audit.log({
          tx,
          entityType: 'compliance_assessment',
          entityId: draft.id,
          action: AuditAction.UPDATE,
          userId: user.id,
          oldValues: toAuditJson({ status: draft.status }),
          newValues: toAuditJson({
            status: AssessmentStatus.submitted,
            overallPercent: dto.percent,
            overallRank: dto.rank,
            itemCount: resolvedQuestions.length,
          }),
          metadata: { source: 'rest', kind: 'self_evaluation_finalize' },
        });

        return { ...updated, center };
      }

      const created = await tx.complianceAssessment.create({
        data: {
          centerId: center.id,
          standardsVersion,
          assessmentDate,
          assessmentType: AssessmentType.self_assessment,
          status: AssessmentStatus.submitted,
          submittedById: user.id,
          submittedAt: now,
          overallClassification: classification,
          overallPercent: new Prisma.Decimal(dto.percent),
          overallRank: dto.rank,
          clientDraftId: dto.clientDraftId ?? null,
          createdAt: now,
          updatedAt: now,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await this.syncSelfEvalAnswerItems(tx, {
        assessmentId: created.id,
        resolvedQuestions,
        now,
        keepScoreItem: true,
        scoreItem,
        standardsVersion: dto.standardsVersion,
      });

      await tx.ecdCenter.update({
        where: { id: center.id },
        data: {
          currentComplianceLevel: classification,
          currentComplianceAssessedAt: assessmentDate,
          updatedAt: now,
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
          overallPercent: dto.percent,
          overallRank: dto.rank,
          overallClassification: classification,
          itemCount: resolvedQuestions.length,
          version: created.version,
        }),
        metadata: { source: 'rest', kind: 'self_evaluation_submit' },
      });

      return { ...created, center };
    });

    void this.notificationEvents.onComplianceAssessmentStatusChanged({
      assessmentId: result.id,
      centerId: center.id,
      centerName: center.name,
      districtId: center.districtId,
      previousStatus: AssessmentStatus.draft,
      newStatus: AssessmentStatus.submitted,
    });

    return this.toAssessmentDto(result);
  }

  /**
   * District/Sector: start a supportive_supervision inspection draft for a center in scope.
   */
  async createInspection(
    user: AuthUser,
    dto: CreateInspectionDto,
  ): Promise<AssessmentDetailResponseDto> {
    this.assertPortalInspector(user);
    this.assertKnownChecklist(dto.facilityTypeId, dto.standardsVersion);

    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: dto.centerId, deletedAt: null },
      select: { id: true, name: true, districtId: true, villageId: true },
    });
    if (!center) {
      throw new NotFoundException('Center not found');
    }
    await assertCenterAccessible(this.prisma, user, center);

    const now = new Date();
    const assessmentDate = new Date(dto.assessmentDate);
    const standardsVersion = encodeSelfEvalStandardsVersion(
      dto.standardsVersion,
      dto.facilityTypeId,
    );

    const createdId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.complianceAssessment.create({
        data: {
          centerId: center.id,
          standardsVersion,
          assessmentDate,
          assessmentType: AssessmentType.supportive_supervision,
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
        metadata: { source: 'rest', kind: 'inspection_create' },
      });

      return created.id;
    });

    return this.getAssessment(user, createdId);
  }

  /**
   * District/Sector: batch-save draft answers by checklist questionId.
   */
  async saveInspectionDraft(
    user: AuthUser,
    assessmentId: string,
    dto: SaveInspectionDraftDto,
  ): Promise<AssessmentDetailResponseDto> {
    this.assertPortalInspector(user);
    this.assertKnownChecklist(dto.facilityTypeId, dto.standardsVersion);
    const { resolvedQuestions } = resolveSelfEvalAnswerItems(dto.facilityTypeId, dto.items ?? [], {
      allowEmpty: true,
    });

    const existing = await this.loadInspectionForWrite(user, assessmentId);
    if (existing.status !== AssessmentStatus.draft) {
      throw new BadRequestException('Can only update draft inspections');
    }

    const now = new Date();
    const assessmentDate = new Date(dto.assessmentDate);
    const standardsVersion = encodeSelfEvalStandardsVersion(
      dto.standardsVersion,
      dto.facilityTypeId,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.complianceAssessment.update({
        where: { id: existing.id },
        data: {
          standardsVersion,
          assessmentDate,
          updatedAt: now,
          lastModifiedAt: now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
        },
      });

      await this.syncSelfEvalAnswerItems(tx, {
        assessmentId: existing.id,
        resolvedQuestions,
        now,
        keepScoreItem: false,
        scoreItem: null,
      });

      await this.audit.log({
        tx,
        entityType: 'compliance_assessment',
        entityId: existing.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          status: AssessmentStatus.draft,
          standardsVersion,
          itemCount: resolvedQuestions.length,
        }),
        metadata: { source: 'rest', kind: 'inspection_draft_save' },
      });
    });

    return this.getAssessment(user, assessmentId);
  }

  /**
   * District/Sector: submit supportive_supervision with backend-authoritative scoring.
   */
  async submitInspection(
    user: AuthUser,
    assessmentId: string,
    dto: SubmitInspectionDto,
  ): Promise<AssessmentResponseDto> {
    this.assertPortalInspector(user);
    this.assertKnownChecklist(dto.facilityTypeId, dto.standardsVersion);

    const existing = await this.loadInspectionForWrite(user, assessmentId);
    if (existing.status !== AssessmentStatus.draft) {
      throw new BadRequestException('Can only submit draft inspections');
    }

    const { answers, resolvedQuestions } = resolveSelfEvalAnswerItems(
      dto.facilityTypeId,
      dto.items,
      { allowEmpty: false },
    );
    this.assertSelfEvalScores(dto, dto.facilityTypeId, answers);

    const classification = this.classificationFromRank(dto.rank);
    const now = new Date();
    const assessmentDate = new Date(dto.assessmentDate);
    const standardsVersion = encodeSelfEvalStandardsVersion(
      dto.standardsVersion,
      dto.facilityTypeId,
    );

    const scoreItem = {
      facilityTypeId: dto.facilityTypeId,
      earnedScore: dto.earnedScore,
      maxScore: dto.maxScore,
      percent: dto.percent,
      rank: dto.rank,
      clientDraftId: null as string | null,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.complianceAssessment.update({
        where: { id: existing.id },
        data: {
          standardsVersion,
          assessmentDate,
          status: AssessmentStatus.submitted,
          submittedById: user.id,
          submittedAt: now,
          overallClassification: classification,
          overallPercent: new Prisma.Decimal(dto.percent),
          overallRank: dto.rank,
          updatedAt: now,
          lastModifiedAt: now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
        },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.syncSelfEvalAnswerItems(tx, {
        assessmentId: existing.id,
        resolvedQuestions,
        now,
        keepScoreItem: true,
        scoreItem,
        standardsVersion: dto.standardsVersion,
      });

      await this.audit.log({
        tx,
        entityType: 'compliance_assessment',
        entityId: existing.id,
        action: AuditAction.STATUS_CHANGE,
        userId: user.id,
        oldValues: toAuditJson({ status: existing.status }),
        newValues: toAuditJson({
          status: AssessmentStatus.submitted,
          overallPercent: dto.percent,
          overallRank: dto.rank,
          overallClassification: classification,
          itemCount: resolvedQuestions.length,
        }),
        metadata: { source: 'rest', kind: 'inspection_submit' },
      });

      return updated;
    });

    void this.notificationEvents.onComplianceAssessmentStatusChanged({
      assessmentId: result.id,
      centerId: result.centerId,
      centerName: result.center.name,
      districtId: result.center.districtId,
      previousStatus: AssessmentStatus.draft,
      newStatus: AssessmentStatus.submitted,
    });

    return this.toAssessmentDto(result);
  }

  private assertPortalInspector(user: AuthUser): void {
    if (!isDistrictPortalRole(user.role)) {
      throw new ForbiddenException('Only District or Sector focal persons can manage inspections');
    }
  }

  private async loadInspectionForWrite(user: AuthUser, assessmentId: string) {
    const existing = await this.prisma.complianceAssessment.findFirst({
      where: { id: assessmentId, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true, villageId: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException('Assessment not found');
    }
    if (existing.assessmentType !== AssessmentType.supportive_supervision) {
      throw new BadRequestException('Assessment is not a supportive supervision inspection');
    }
    await assertCenterAccessible(this.prisma, user, {
      id: existing.centerId,
      districtId: existing.center.districtId,
      villageId: existing.center.villageId,
    });
    return existing;
  }

  private async requireDirectorCenter(user: AuthUser): Promise<{
    id: string;
    name: string;
    districtId: string;
  }> {
    if (!isCenterAdminRole(user.role)) {
      throw new ForbiddenException('Only ECD directors can manage self-evaluations');
    }
    if (!user.centerId) {
      throw new ForbiddenException('Center scope is required for this role');
    }

    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: user.centerId, deletedAt: null },
      select: { id: true, name: true, districtId: true },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    assertCenterAccess(user, center.id, center.districtId);
    return center;
  }

  private async requireCenterStaffCenter(user: AuthUser): Promise<{
    id: string;
    name: string;
    districtId: string;
  }> {
    return this.requireDirectorCenter(user);
  }

  private assertKnownChecklist(facilityTypeId: string, standardsVersion: string): void {
    const checklist = getFacilityChecklist(facilityTypeId);
    if (!checklist) {
      throw new BadRequestException(`Unknown facility type: ${facilityTypeId}`);
    }
    if (checklist.version !== standardsVersion) {
      throw new BadRequestException(
        `standardsVersion ${standardsVersion} does not match checklist ${checklist.version}`,
      );
    }
  }

  private assertSelfEvalScores(
    dto: Pick<SubmitSelfEvaluationDto, 'earnedScore' | 'maxScore' | 'percent' | 'rank'>,
    facilityTypeId: string,
    answers: Record<string, boolean>,
  ): void {
    const computed = scoreSelfEvaluationFromAnswers(facilityTypeId, answers);
    if (!computed) {
      throw new BadRequestException(`Unable to score facility type: ${facilityTypeId}`);
    }
    if (computed.maxScore !== dto.maxScore) {
      throw new BadRequestException(
        `maxScore ${dto.maxScore} does not match checklist max (${computed.maxScore})`,
      );
    }
    if (computed.earnedScore !== dto.earnedScore) {
      throw new BadRequestException(
        `earnedScore ${dto.earnedScore} does not match answers (${computed.earnedScore})`,
      );
    }
    const expectedPercent =
      dto.maxScore > 0 ? Math.round((dto.earnedScore / dto.maxScore) * 100) : 0;
    if (expectedPercent !== dto.percent || computed.percent !== dto.percent) {
      throw new BadRequestException(
        `percent ${dto.percent} does not match earned/max (${expectedPercent})`,
      );
    }
    const expectedRank = this.rankFromPercent(dto.percent);
    if (expectedRank !== dto.rank || computed.rank !== dto.rank) {
      throw new BadRequestException(
        `rank ${dto.rank} does not match percent ${dto.percent} (expected ${expectedRank})`,
      );
    }
  }

  private selfEvalDraftWhere(centerId: string): Prisma.ComplianceAssessmentWhereInput {
    return {
      centerId,
      assessmentType: AssessmentType.self_assessment,
      status: AssessmentStatus.draft,
      deletedAt: null,
    };
  }

  private async findSelfEvalDraftRow(
    db: Prisma.TransactionClient | PrismaService,
    centerId: string,
  ) {
    return db.complianceAssessment.findFirst({
      where: this.selfEvalDraftWhere(centerId),
      include: {
        center: { select: { id: true, name: true, districtId: true } },
        items: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }],
          include: { standard: { select: { code: true, title: true } } },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  private async ensureSelfEvalDraftRow(
    tx: Prisma.TransactionClient,
    input: {
      centerId: string;
      standardsVersion: string;
      assessmentDate: Date;
      clientDraftId?: string;
      userId: string;
      now: Date;
    },
  ): Promise<{ id: string; clientDraftId: string | null }> {
    const existing = await this.findSelfEvalDraftRow(tx, input.centerId);
    if (existing) {
      const updated = await tx.complianceAssessment.update({
        where: { id: existing.id },
        data: {
          standardsVersion: input.standardsVersion,
          assessmentDate: input.assessmentDate,
          clientDraftId: input.clientDraftId ?? existing.clientDraftId,
          updatedAt: input.now,
          lastModifiedAt: input.now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
        },
      });
      return { id: updated.id, clientDraftId: updated.clientDraftId };
    }

    try {
      const created = await tx.complianceAssessment.create({
        data: {
          centerId: input.centerId,
          standardsVersion: input.standardsVersion,
          assessmentDate: input.assessmentDate,
          assessmentType: AssessmentType.self_assessment,
          status: AssessmentStatus.draft,
          clientDraftId: input.clientDraftId ?? null,
          createdAt: input.now,
          updatedAt: input.now,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: input.now,
        },
      });
      return { id: created.id, clientDraftId: created.clientDraftId };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.findSelfEvalDraftRow(tx, input.centerId);
        if (raced) {
          const updated = await tx.complianceAssessment.update({
            where: { id: raced.id },
            data: {
              standardsVersion: input.standardsVersion,
              assessmentDate: input.assessmentDate,
              clientDraftId: input.clientDraftId ?? raced.clientDraftId,
              updatedAt: input.now,
              lastModifiedAt: input.now,
              version: { increment: 1 },
              syncStatus: RecordSyncStatus.synced,
            },
          });
          return { id: updated.id, clientDraftId: updated.clientDraftId };
        }
      }
      throw error;
    }
  }

  private async syncSelfEvalAnswerItems(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      resolvedQuestions: ReturnType<typeof resolveSelfEvalAnswerItems>['resolvedQuestions'];
      now: Date;
      keepScoreItem: boolean;
      scoreItem: {
        facilityTypeId: string;
        earnedScore: number;
        maxScore: number;
        percent: number;
        rank: string;
        clientDraftId: string | null;
      } | null;
      standardsVersion?: string;
    },
  ): Promise<void> {
    const questionStandards = await this.ensureQuestionStandards(
      tx,
      input.resolvedQuestions.map((q) => q.def),
    );
    const desiredStandardIds = new Set<string>();
    for (const { def } of input.resolvedQuestions) {
      const standardId = questionStandards.get(def.questionId);
      if (!standardId) {
        throw new BadRequestException(`Failed to resolve standard for ${def.questionId}`);
      }
      desiredStandardIds.add(standardId);
    }

    let scoreStandardId: string | null = null;
    if (input.keepScoreItem && input.scoreItem) {
      const scoreStandard = await this.ensureSelfEvalScoreStandard(
        tx,
        input.standardsVersion ?? '2024.1',
      );
      scoreStandardId = scoreStandard.id;
      desiredStandardIds.add(scoreStandard.id);
    }

    const existing = await tx.complianceAssessmentItem.findMany({
      where: { assessmentId: input.assessmentId, deletedAt: null },
      include: { standard: { select: { id: true, code: true } } },
    });

    const extraIds = existing
      .filter((row) => {
        if (row.standard?.code === SELF_EVAL_SCORE_CODE) {
          return !input.keepScoreItem;
        }
        return !desiredStandardIds.has(row.standardId);
      })
      .map((row) => row.id);

    if (extraIds.length > 0) {
      await tx.complianceAssessmentItem.deleteMany({ where: { id: { in: extraIds } } });
    }

    for (const { def, met } of input.resolvedQuestions) {
      const standardId = questionStandards.get(def.questionId)!;
      const found = existing.find(
        (row) => row.standardId === standardId && !extraIds.includes(row.id),
      );
      const data = {
        response: met ? ItemResponse.met : ItemResponse.not_met,
        score: new Prisma.Decimal(met ? def.maxScore : 0),
        updatedAt: input.now,
        lastModifiedAt: input.now,
        syncStatus: RecordSyncStatus.synced,
      };
      if (found) {
        await tx.complianceAssessmentItem.update({
          where: { id: found.id },
          data: { ...data, version: { increment: 1 } },
        });
      } else {
        await tx.complianceAssessmentItem.create({
          data: {
            assessmentId: input.assessmentId,
            standardId,
            ...data,
            createdAt: input.now,
            version: 1,
          },
        });
      }
    }

    if (input.keepScoreItem && input.scoreItem && scoreStandardId) {
      const foundScore = existing.find(
        (row) => row.standard?.code === SELF_EVAL_SCORE_CODE && !extraIds.includes(row.id),
      );
      const scoreData = {
        response: ItemResponse.met,
        score: new Prisma.Decimal(input.scoreItem.percent),
        evidenceNotes: JSON.stringify(input.scoreItem),
        updatedAt: input.now,
        lastModifiedAt: input.now,
        syncStatus: RecordSyncStatus.synced,
      };
      if (foundScore) {
        await tx.complianceAssessmentItem.update({
          where: { id: foundScore.id },
          data: { ...scoreData, version: { increment: 1 } },
        });
      } else {
        await tx.complianceAssessmentItem.create({
          data: {
            assessmentId: input.assessmentId,
            standardId: scoreStandardId,
            ...scoreData,
            createdAt: input.now,
            version: 1,
          },
        });
      }
    }
  }

  private toAssessmentDetailDto(row: {
    id: string;
    centerId: string;
    standardsVersion: string;
    assessmentType: string;
    assessmentDate: Date;
    status: string;
    submittedById: string | null;
    submittedAt: Date | null;
    verifiedById: string | null;
    verifiedAt: Date | null;
    overallClassification: ComplianceClassification | null;
    overallPercent?: Prisma.Decimal | null;
    overallRank?: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    clientDraftId?: string | null;
    center: { id: string; name: string; districtId: string };
    items: Array<{
      id: string;
      assessmentId: string;
      standardId: string;
      response: string;
      score: Prisma.Decimal | null;
      evidenceNotes: string | null;
      gapSeverity: string | null;
      gapImprovementAction: string | null;
      gapTargetDate: Date | null;
      gapStatus: string | null;
      gapResolvedAt: Date | null;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      standard?: { code: string; title: string } | null;
    }>;
  }): AssessmentDetailResponseDto {
    return {
      ...this.toAssessmentDto(row),
      items: row.items.map((item) => this.toItemDto(item)),
    };
  }

  private rankFromPercent(percent: number): 'green' | 'blue' | 'yellow' | 'red' {
    if (percent >= 90) return 'green';
    if (percent >= 70) return 'blue';
    if (percent >= 50) return 'yellow';
    return 'red';
  }

  private classificationFromRank(
    rank: 'green' | 'blue' | 'yellow' | 'red',
  ): ComplianceClassification {
    switch (rank) {
      case 'green':
      case 'blue':
        return ComplianceClassification.compliant;
      case 'yellow':
        return ComplianceClassification.partially_compliant;
      case 'red':
        return ComplianceClassification.non_compliant;
    }
  }

  private async ensureSelfEvalScoreStandard(
    tx: Prisma.TransactionClient,
    version: string,
  ): Promise<{ id: string }> {
    const code = SELF_EVAL_SCORE_CODE;
    const existing = await tx.ecdStandard.findUnique({ where: { code } });
    if (existing) {
      return { id: existing.id };
    }
    const created = await tx.ecdStandard.create({
      data: {
        code,
        domain: StandardDomain.safety,
        title: 'ECD Standards self-evaluation overall score',
        description:
          'Synthetic standard used to store rounded self-evaluation percent (0–100) as item score.',
        weight: new Prisma.Decimal(100),
        version,
        isActive: true,
      },
    });
    return { id: created.id };
  }

  /**
   * Find-or-create EcdStandard rows keyed by checklist questionId (`code`).
   * Never inserts a second row for an existing code.
   */
  private async ensureQuestionStandards(
    tx: Prisma.TransactionClient,
    questions: Array<{
      questionId: string;
      title: string;
      maxScore: number;
      facilityTypeId: string;
      sectionId: string;
      version: string;
    }>,
  ): Promise<Map<string, string>> {
    const unique = new Map(questions.map((q) => [q.questionId, q]));
    const codes = [...unique.keys()];
    const byCode = new Map<string, string>();

    const existing = await tx.ecdStandard.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, weight: true, version: true },
    });
    for (const row of existing) {
      byCode.set(row.code, row.id);
    }

    // SELF-EVAL-WEIGHT-01: keep a single EcdStandard per questionId; sync weight/version
    // from the current checklist without touching historical assessment item scores.
    for (const q of unique.values()) {
      const existingId = byCode.get(q.questionId);
      if (!existingId) {
        continue;
      }
      const row = existing.find((r) => r.code === q.questionId);
      if (!row) {
        continue;
      }
      const currentWeight = row.weight != null ? Number(row.weight) : null;
      const needsWeightUpdate = currentWeight !== q.maxScore;
      const needsVersionUpdate = row.version !== q.version;
      if (needsWeightUpdate || needsVersionUpdate) {
        await tx.ecdStandard.update({
          where: { id: existingId },
          data: {
            ...(needsWeightUpdate ? { weight: new Prisma.Decimal(q.maxScore) } : {}),
            ...(needsVersionUpdate ? { version: q.version } : {}),
          },
        });
      }
    }

    const missing = [...unique.values()].filter((q) => !byCode.has(q.questionId));
    if (missing.length > 0) {
      await tx.ecdStandard.createMany({
        data: missing.map((q) => ({
          code: q.questionId,
          domain: StandardDomain.safety,
          title: q.title.slice(0, 500),
          description: `Self-evaluation question (${q.facilityTypeId}/${q.sectionId})`,
          weight: new Prisma.Decimal(q.maxScore),
          version: q.version,
          isActive: true,
        })),
        skipDuplicates: true,
      });

      const created = await tx.ecdStandard.findMany({
        where: { code: { in: missing.map((q) => q.questionId) } },
        select: { id: true, code: true },
      });
      for (const row of created) {
        byCode.set(row.code, row.id);
      }
    }

    const unresolved = codes.filter((code) => !byCode.has(code));
    if (unresolved.length > 0) {
      throw new BadRequestException(
        `Failed to persist standards for questionIds: ${unresolved.join(', ')}`,
      );
    }

    return byCode;
  }

  async updateAssessment(
    user: AuthUser,
    id: string,
    dto: UpdateAssessmentDto,
  ): Promise<AssessmentResponseDto> {
    const existing = await this.prisma.complianceAssessment.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true, villageId: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('Assessment not found');
    }

    await assertCenterAccessible(this.prisma, user, {
      id: existing.centerId,
      districtId: existing.center.districtId,
      villageId: existing.center.villageId,
    });

    if (dto.status) {
      this.validateStatusTransition(asDomainEnum<AssessmentStatus>(existing.status), dto.status);
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
      const data: Prisma.ComplianceAssessmentUncheckedUpdateManyInput = {
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
      };

      if (dto.status != null) {
        data.status = dto.status;
      }

      const cas = await tx.complianceAssessment.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data,
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

    if (dto.status && dto.status !== asDomainEnum<AssessmentStatus>(existing.status)) {
      void this.notificationEvents.onComplianceAssessmentStatusChanged({
        assessmentId: existing.id,
        centerId: existing.centerId,
        centerName: existing.center.name,
        districtId: existing.center.districtId,
        previousStatus: asDomainEnum<AssessmentStatus>(existing.status),
        newStatus: dto.status,
      });
    }

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
        center: { select: { id: true, districtId: true, villageId: true } },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    await assertCenterAccessible(this.prisma, user, {
      id: assessment.centerId,
      districtId: assessment.center.districtId,
      villageId: assessment.center.villageId,
    });

    if (assessment.status !== AssessmentStatus.draft) {
      throw new BadRequestException('Can only add items to draft assessments');
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
          score: dto.score != null ? new Prisma.Decimal(dto.score) : null,
          evidenceNotes: dto.evidenceNotes ?? null,
          gapImprovementAction: dto.gapImprovementAction ?? null,
          gapTargetDate: dto.gapTargetDate ? new Date(dto.gapTargetDate) : null,
          gapResolvedAt: dto.gapResolvedAt ? new Date(dto.gapResolvedAt) : null,
          response: dto.response,
          gapSeverity: dto.gapSeverity ?? null,
          gapStatus: dto.gapStatus ?? null,
          createdAt: now,
          updatedAt: now,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
        include: {
          standard: { select: { code: true, title: true } },
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
        center: { select: { id: true, districtId: true, villageId: true } },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    await assertCenterAccessible(this.prisma, user, {
      id: assessment.centerId,
      districtId: assessment.center.districtId,
      villageId: assessment.center.villageId,
    });

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
      const data: Prisma.ComplianceAssessmentItemUncheckedUpdateManyInput = {
        ...(dto.score !== undefined && {
          score: dto.score != null ? new Prisma.Decimal(dto.score) : null,
        }),
        ...(dto.evidenceNotes !== undefined && {
          evidenceNotes: dto.evidenceNotes ?? null,
        }),
        ...(dto.gapImprovementAction !== undefined && {
          gapImprovementAction: dto.gapImprovementAction ?? null,
        }),
        ...(dto.gapTargetDate !== undefined && {
          gapTargetDate: dto.gapTargetDate ? new Date(dto.gapTargetDate) : null,
        }),
        ...(dto.gapResolvedAt !== undefined && {
          gapResolvedAt: dto.gapResolvedAt ? new Date(dto.gapResolvedAt) : null,
        }),
        updatedAt: now,
        version: { increment: 1 },
        syncStatus: RecordSyncStatus.synced,
        lastModifiedAt: now,
      };

      if (dto.response != null) {
        data.response = dto.response;
      }
      if (dto.gapSeverity !== undefined) {
        data.gapSeverity = dto.gapSeverity ?? null;
      }
      if (dto.gapStatus !== undefined) {
        data.gapStatus = dto.gapStatus ?? null;
      }

      const cas = await tx.complianceAssessmentItem.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data,
      });

      await assertCasApplied(cas.count, 'compliance_assessment_item', () =>
        tx.complianceAssessmentItem.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const updated = await tx.complianceAssessmentItem.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          standard: { select: { code: true, title: true } },
        },
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

  private async buildListWhere(
    user: AuthUser,
    query: ListAssessmentsQueryDto,
  ): Promise<Prisma.ComplianceAssessmentWhereInput> {
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
        throw new ForbiddenException('District scope is required for district focal persons');
      }
      if (query.districtId && query.districtId !== user.districtId) {
        throw new ForbiddenException('Access to other districts is denied');
      }
      where.center = { districtId: user.districtId };
    } else if (user.role === UserRole.sector_focal_person) {
      const scoped = await centerOwnedListFilter(this.prisma, user, {
        districtId: query.districtId,
        centerId: query.centerId,
      });
      if (typeof scoped.centerId === 'string') {
        where.centerId = scoped.centerId;
      } else if (scoped.centerId) {
        where.centerId = scoped.centerId;
      } else {
        where.centerId = { in: [] };
      }
    } else if (user.role === UserRole.ncda_admin) {
      if (query.districtId) {
        where.center = { districtId: query.districtId };
      }
    }

    if (query.centerId) {
      if (isCenterStaffRole(user.role)) {
        if (query.centerId !== user.centerId) {
          throw new ForbiddenException('Access to other centers is denied');
        }
      } else {
        where.centerId = query.centerId;
      }
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.assessmentType) {
      where.assessmentType = query.assessmentType;
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

  private validateStatusTransition(current: AssessmentStatus, next: AssessmentStatus): void {
    const validTransitions: Record<AssessmentStatus, AssessmentStatus[]> = {
      [AssessmentStatus.draft]: [AssessmentStatus.submitted],
      [AssessmentStatus.submitted]: [AssessmentStatus.verified, AssessmentStatus.rejected],
      [AssessmentStatus.verified]: [],
      [AssessmentStatus.rejected]: [AssessmentStatus.submitted],
    };

    if (!validTransitions[current]?.includes(next)) {
      throw new BadRequestException(`Invalid status transition from ${current} to ${next}`);
    }
  }

  private toAssessmentDto(row: {
    id: string;
    centerId: string;
    standardsVersion: string;
    assessmentType: string;
    assessmentDate: Date;
    status: string;
    submittedById: string | null;
    submittedAt: Date | null;
    verifiedById: string | null;
    verifiedAt: Date | null;
    overallClassification: ComplianceClassification | null;
    overallPercent?: Prisma.Decimal | null;
    overallRank?: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    clientDraftId?: string | null;
    center: { id: string; name: string; districtId: string };
  }): AssessmentResponseDto {
    const parsed = parseSelfEvalStandardsVersion(row.standardsVersion);
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      standardsVersion: row.standardsVersion,
      assessmentType: asDomainEnum<AssessmentType>(row.assessmentType),
      assessmentDate: row.assessmentDate,
      status: asDomainEnum<AssessmentStatus>(row.status),
      submittedById: row.submittedById,
      submittedAt: row.submittedAt,
      verifiedById: row.verifiedById,
      verifiedAt: row.verifiedAt,
      overallClassification: row.overallClassification,
      overallPercent: row.overallPercent != null ? Number(row.overallPercent) : null,
      overallRank: row.overallRank ?? null,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      facilityTypeId: parsed.facilityTypeId || null,
      clientDraftId: row.clientDraftId ?? null,
    };
  }

  private toItemDto(row: {
    id: string;
    assessmentId: string;
    standardId: string;
    response: string;
    score: Prisma.Decimal | null;
    evidenceNotes: string | null;
    gapSeverity: string | null;
    gapImprovementAction: string | null;
    gapTargetDate: Date | null;
    gapStatus: string | null;
    gapResolvedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    standard?: { code: string; title: string } | null;
  }): AssessmentItemResponseDto {
    return {
      id: row.id,
      assessmentId: row.assessmentId,
      standardId: row.standardId,
      standardCode: row.standard?.code ?? '',
      standardTitle: row.standard?.title ?? null,
      response: asDomainEnum<ItemResponse>(row.response),
      score: row.score != null ? row.score.toNumber() : null,
      evidenceNotes: row.evidenceNotes,
      gapSeverity: asDomainEnumNullable<GapSeverity>(row.gapSeverity),
      gapImprovementAction: row.gapImprovementAction,
      gapTargetDate: row.gapTargetDate,
      gapStatus: asDomainEnumNullable<GapStatus>(row.gapStatus),
      gapResolvedAt: row.gapResolvedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toStandardDto(row: {
    id: string;
    domain: string;
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
      domain: asDomainEnum<StandardDomain>(row.domain),
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
