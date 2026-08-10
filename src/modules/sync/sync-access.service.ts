import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncableEntityType } from './sync.constants';

export interface AccessScope {
  centerIds: string[] | 'all';
  districtId: string | null;
}

/** Entity types caregivers must never write via sync (even if later added to SYNCABLE). */
export const CAREGIVER_FORBIDDEN_SYNC_ENTITY_TYPES = [
  'ecd_center',
  'user_account',
  'district',
  'administrative_unit',
  'ecd_standard',
  'app_setting',
] as const;

export type SyncWriteAuthResult =
  | { allowed: true }
  | { allowed: false; reason: string };

@Injectable()
export class SyncAccessService {
  private readonly logger = new Logger(SyncAccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveScope(user: AuthUser): Promise<AccessScope> {
    if (user.role === UserRole.ncda_admin) {
      return { centerIds: 'all', districtId: null };
    }

    if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required for this role');
      }

      const centers = await this.prisma.ecdCenter.findMany({
        where: { districtId: user.districtId, deletedAt: null },
        select: { id: true },
      });

      return {
        centerIds: centers.map((c) => c.id),
        districtId: user.districtId,
      };
    }

    // caregiver
    if (!user.centerId) {
      throw new ForbiddenException('Center scope is required for caregivers');
    }

    return { centerIds: [user.centerId], districtId: user.districtId };
  }

  centerFilter(scope: AccessScope): { centerId?: { in: string[] } } | Record<string, never> {
    if (scope.centerIds === 'all') {
      return {};
    }
    return { centerId: { in: scope.centerIds } };
  }

  ecdCenterFilter(
    scope: AccessScope,
  ): { id?: { in: string[] }; districtId?: string } | Record<string, never> {
    if (scope.centerIds === 'all') {
      return {};
    }
    if (scope.districtId) {
      return { districtId: scope.districtId };
    }
    return { id: { in: scope.centerIds } };
  }

  isCenterInScope(scope: AccessScope, centerId: string): boolean {
    if (scope.centerIds === 'all') {
      return true;
    }
    return scope.centerIds.includes(centerId);
  }

  isEntityTypePermittedForRole(
    role: UserRole,
    entityType: string,
  ): boolean {
    if (role === UserRole.ncda_admin) {
      return true;
    }

    if (role === UserRole.caregiver) {
      return !(CAREGIVER_FORBIDDEN_SYNC_ENTITY_TYPES as readonly string[]).includes(
        entityType,
      );
    }

    // district_focal_person may write all syncable types including ecd_center
    return true;
  }

  /**
   * Per-operation write authorization for sync push/apply.
   * Must run before any entity write is applied.
   */
  async authorizeSyncWrite(params: {
    user: AuthUser;
    scope: AccessScope;
    entityType: string;
    entityId: string;
    operation: AuditAction;
    payload: Record<string, unknown>;
  }): Promise<SyncWriteAuthResult> {
    const { user, scope, entityType, entityId, operation, payload } = params;

    if (user.role === UserRole.ncda_admin) {
      return { allowed: true };
    }

    if (!this.isEntityTypePermittedForRole(user.role, entityType)) {
      return {
        allowed: false,
        reason: 'entity type not permitted for role',
      };
    }

    if (entityType === 'ecd_center') {
      return this.authorizeEcdCenterWrite(scope, entityId, operation, payload);
    }

    if (entityType === 'child_transfer') {
      return this.authorizeChildTransferWrite(scope, entityId, operation, payload);
    }

    const centerId = await this.resolveEntityCenterId(
      entityType as SyncableEntityType,
      entityId,
      operation,
      payload,
    );

    if (!centerId) {
      return { allowed: false, reason: 'center out of scope' };
    }

    if (!this.isCenterInScope(scope, centerId)) {
      return { allowed: false, reason: 'center out of scope' };
    }

    return { allowed: true };
  }

  private async authorizeEcdCenterWrite(
    scope: AccessScope,
    entityId: string,
    operation: AuditAction,
    payload: Record<string, unknown>,
  ): Promise<SyncWriteAuthResult> {
    if (scope.centerIds === 'all') {
      return { allowed: true };
    }

    if (operation === AuditAction.create) {
      const districtId =
        typeof payload.districtId === 'string' ? payload.districtId : null;
      if (!districtId || !scope.districtId || districtId !== scope.districtId) {
        return { allowed: false, reason: 'center out of scope' };
      }
      return { allowed: true };
    }

    const center = await this.prisma.ecdCenter.findUnique({
      where: { id: entityId },
      select: { id: true, districtId: true },
    });

    if (!center) {
      // CREATE already handled; missing row on update/delete → out of scope / not writable
      return { allowed: false, reason: 'center out of scope' };
    }

    if (scope.districtId && center.districtId === scope.districtId) {
      return { allowed: true };
    }

    if (this.isCenterInScope(scope, center.id)) {
      return { allowed: true };
    }

    return { allowed: false, reason: 'center out of scope' };
  }

  private async authorizeChildTransferWrite(
    scope: AccessScope,
    entityId: string,
    operation: AuditAction,
    payload: Record<string, unknown>,
  ): Promise<SyncWriteAuthResult> {
    if (scope.centerIds === 'all') {
      return { allowed: true };
    }

    let fromCenterId: string | null = null;
    let toCenterId: string | null = null;

    if (operation === AuditAction.create) {
      fromCenterId =
        typeof payload.fromCenterId === 'string' ? payload.fromCenterId : null;
      toCenterId =
        typeof payload.toCenterId === 'string' ? payload.toCenterId : null;

      if (!fromCenterId || !toCenterId) {
        return { allowed: false, reason: 'center out of scope' };
      }

      // Create: source center scope only
      if (!this.isCenterInScope(scope, fromCenterId)) {
        return { allowed: false, reason: 'center out of scope' };
      }

      return { allowed: true };
    }

    const transfer = await this.prisma.childTransfer.findUnique({
      where: { id: entityId },
      select: { fromCenterId: true, toCenterId: true, status: true },
    });
    fromCenterId = transfer?.fromCenterId ?? null;
    toCenterId = transfer?.toCenterId ?? null;

    if (!fromCenterId || !toCenterId) {
      return { allowed: false, reason: 'center out of scope' };
    }

    if (operation === AuditAction.update) {
      const targetStatus = String(payload.status ?? '');

      if (targetStatus === 'accepted') {
        if (!this.isCenterInScope(scope, toCenterId)) {
          return { allowed: false, reason: 'center out of scope' };
        }
        return { allowed: true };
      }

      if (targetStatus === 'cancelled') {
        if (!this.isCenterInScope(scope, fromCenterId)) {
          return { allowed: false, reason: 'center out of scope' };
        }
        return { allowed: true };
      }

      return { allowed: false, reason: 'center out of scope' };
    }

    // delete: either end in scope
    if (
      !this.isCenterInScope(scope, fromCenterId) &&
      !this.isCenterInScope(scope, toCenterId)
    ) {
      return { allowed: false, reason: 'center out of scope' };
    }

    return { allowed: true };
  }

  /**
   * Resolves the center that owns an entity for scope checks.
   * For CREATE, uses payload fields when the row does not exist yet.
   */
  async resolveEntityCenterId(
    entityType: SyncableEntityType,
    entityId: string,
    operation: AuditAction,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    if (operation === AuditAction.create) {
      return this.centerIdFromPayload(entityType, payload);
    }

    switch (entityType) {
      case 'child': {
        const row = await this.prisma.child.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'attendance_record': {
        const row = await this.prisma.attendanceRecord.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'sted_assessment': {
        const row = await this.prisma.stedAssessment.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'referral': {
        const row = await this.prisma.referral.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'wash_indicator': {
        const row = await this.prisma.washIndicator.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'center_feeding_day': {
        const row = await this.prisma.centerFeedingDay.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'center_feeding_month_summary': {
        const row = await this.prisma.centerFeedingMonthSummary.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'compliance_assessment': {
        const row = await this.prisma.complianceAssessment.findUnique({
          where: { id: entityId },
          select: { centerId: true },
        });
        return row?.centerId ?? this.centerIdFromPayload(entityType, payload);
      }
      case 'child_nutrition_screening': {
        const row = await this.prisma.childNutritionScreening.findUnique({
          where: { id: entityId },
          select: { child: { select: { centerId: true } } },
        });
        if (row?.child.centerId) {
          return row.child.centerId;
        }
        return this.centerIdFromPayload(entityType, payload);
      }
      case 'compliance_assessment_item': {
        const row = await this.prisma.complianceAssessmentItem.findUnique({
          where: { id: entityId },
          select: { assessment: { select: { centerId: true } } },
        });
        if (row?.assessment.centerId) {
          return row.assessment.centerId;
        }
        return this.centerIdFromPayload(entityType, payload);
      }
      case 'ecd_center':
        return entityId;
      case 'child_transfer':
        return null; // handled separately
      default:
        return null;
    }
  }

  private async centerIdFromPayload(
    entityType: SyncableEntityType,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    if (typeof payload.centerId === 'string') {
      return payload.centerId;
    }

    if (entityType === 'ecd_center' && typeof payload.id === 'string') {
      return payload.id;
    }

    if (
      entityType === 'child_nutrition_screening' ||
      entityType === 'attendance_record' ||
      entityType === 'sted_assessment' ||
      entityType === 'referral'
    ) {
      const childId =
        typeof payload.childId === 'string' ? payload.childId : null;
      if (!childId) {
        return null;
      }
      const child = await this.prisma.child.findUnique({
        where: { id: childId },
        select: { centerId: true },
      });
      return child?.centerId ?? null;
    }

    if (entityType === 'compliance_assessment_item') {
      const assessmentId =
        typeof payload.assessmentId === 'string' ? payload.assessmentId : null;
      if (!assessmentId) {
        return null;
      }
      const assessment = await this.prisma.complianceAssessment.findUnique({
        where: { id: assessmentId },
        select: { centerId: true },
      });
      return assessment?.centerId ?? null;
    }

    return null;
  }

  logRejectedSyncOperation(params: {
    userId: string;
    role: UserRole;
    entityType: string;
    entityId: string;
    reason: string;
  }): void {
    this.logger.warn(
      `Sync write rejected user=${params.userId} role=${params.role} ` +
        `entity=${params.entityType}/${params.entityId} reason="${params.reason}"`,
    );
  }
}
