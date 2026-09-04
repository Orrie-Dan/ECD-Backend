import { UserRole } from '../../common/domain';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertDistrictAccess } from '../../common/auth/scope.util';
import { resolveInclusiveDateRange } from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  compareSeverity,
  computeStedCoveragePct,
  DISTRICT_RISK_METHODOLOGY_VERSION,
  interpretDistrictRisk,
  roundRate,
} from './district-risk.policy';
import { DistrictRiskQueryDto } from './dto/district-risk-query.dto';
import { DistrictRiskItemDto, DistrictRiskResponseDto } from './dto/district-risk-response.dto';

@Injectable()
export class DistrictRiskService {
  constructor(private readonly prisma: PrismaService) {}

  async getDistrictRisk(
    user: AuthUser,
    query: DistrictRiskQueryDto,
  ): Promise<DistrictRiskResponseDto> {
    const districtFilter = this.resolveDistrictFilter(user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);

    const districts = await this.prisma.district.findMany({
      where: districtFilter ? { id: districtFilter } : {},
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });

    if (districtFilter && districts.length === 0) {
      throw new NotFoundException('District not found');
    }

    const districtIds = districts.map((d) => d.id);
    if (districtIds.length === 0) {
      return this.emptyResponse(from, to);
    }

    const [
      centersByDistrict,
      activeChildrenByDistrict,
      attendanceByDistrict,
      nutritionByDistrict,
      pendingReferralsByDistrict,
      stedByDistrict,
      stedFollowUpsByDistrict,
    ] = await Promise.all([
      this.aggregateCentersByDistrict(districtIds),
      this.aggregateActiveChildrenByDistrict(districtIds),
      this.aggregateAttendanceByDistrict(districtIds, from, to),
      this.aggregateNutritionByDistrict(districtIds, from, to),
      this.aggregatePendingReferralsByDistrict(districtIds),
      this.aggregateStedByDistrict(districtIds, from, to),
      this.aggregateStedPendingFollowUpsByDistrict(districtIds, to),
    ]);

    const items: DistrictRiskItemDto[] = districts.map((district) => {
      const centersInScope = centersByDistrict.get(district.id) ?? 0;
      const activeChildren = activeChildrenByDistrict.get(district.id) ?? 0;
      const attendance = attendanceByDistrict.get(district.id) ?? { present: 0, absent: 0 };
      const attendanceRecords = attendance.present + attendance.absent;
      const attendanceRate = roundRate(attendance.present, attendanceRecords);

      const nutrition = nutritionByDistrict.get(district.id) ?? {
        screenings: 0,
        severe: 0,
      };
      const pendingReferralCount = pendingReferralsByDistrict.get(district.id) ?? 0;

      const sted = stedByDistrict.get(district.id) ?? {
        assessmentsCompleted: 0,
        childrenAssessed: 0,
      };
      const stedPendingFollowUps = stedFollowUpsByDistrict.get(district.id) ?? 0;
      const stedCoverage = computeStedCoveragePct(sted.childrenAssessed, activeChildren);

      const interpretation = interpretDistrictRisk({
        isActive: district.isActive,
        centersInScope,
        activeChildren,
        attendanceRecords,
        stedCoveragePct: stedCoverage,
        stedAssessmentsCompleted: sted.assessmentsCompleted,
      });

      const signalFlags = [...interpretation.signalFlags];
      if (nutrition.severe > 0) signalFlags.push('nutrition_severe_present');
      if (pendingReferralCount > 0) signalFlags.push('referrals_pending_present');

      return {
        districtId: district.id,
        districtName: district.name,
        districtCode: district.code,
        isActive: district.isActive,
        activeChildren,
        centersInScope,
        attendanceRate,
        attendanceRecords,
        severeNutritionCount: nutrition.severe,
        nutritionScreenings: nutrition.screenings,
        pendingReferralCount,
        stedAssessmentsCompleted: sted.assessmentsCompleted,
        stedChildrenAssessed: sted.childrenAssessed,
        stedCoverage,
        stedPendingFollowUps,
        severity: interpretation.severity,
        riskScore: interpretation.riskScore,
        primaryIssueCode: interpretation.primaryIssueCode,
        signalFlags,
        dataQuality: interpretation.dataQuality,
      };
    });

    items.sort((a, b) => {
      const sev = compareSeverity(a.severity, b.severity);
      if (sev !== 0) return sev;
      return a.districtName.localeCompare(b.districtName);
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      methodologyVersion: DISTRICT_RISK_METHODOLOGY_VERSION,
      items,
      total: items.length,
    };
  }

  /**
   * National situational awareness: NCDA admin (optional district filter) or district focal (own district).
   */
  private resolveDistrictFilter(user: AuthUser, query: DistrictRiskQueryDto): string | null {
    if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required');
      }
      if (query.districtId && query.districtId !== user.districtId) {
        assertDistrictAccess(user, query.districtId);
      }
      return user.districtId;
    }

    if (user.role === UserRole.ncda_admin) {
      if (query.districtId) {
        return query.districtId;
      }
      return null;
    }

    throw new ForbiddenException(
      'District risk is available to NCDA and district focal roles only',
    );
  }

  private emptyResponse(from: Date, to: Date): DistrictRiskResponseDto {
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      methodologyVersion: DISTRICT_RISK_METHODOLOGY_VERSION,
      items: [],
      total: 0,
    };
  }

  private districtIdFilter(districtIds: string[]): Prisma.Sql {
    if (districtIds.length === 0) return Prisma.sql`FALSE`;
    return Prisma.sql`d.id IN (${Prisma.join(districtIds)})`;
  }

  private async aggregateCentersByDistrict(districtIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ districtId: string; cnt: number }>>`
      SELECT d.id AS "districtId", COUNT(c.id)::int AS cnt
      FROM district d
      LEFT JOIN ecd_center c ON c.district_id = d.id AND c.deleted_at IS NULL
      WHERE ${this.districtIdFilter(districtIds)}
      GROUP BY d.id
    `;
    return new Map(rows.map((r) => [r.districtId, r.cnt]));
  }

  private async aggregateActiveChildrenByDistrict(
    districtIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ districtId: string; cnt: number }>>`
      SELECT c.district_id AS "districtId", COUNT(ch.id)::int AS cnt
      FROM child ch
      INNER JOIN ecd_center c ON c.id = ch.center_id AND c.deleted_at IS NULL
      INNER JOIN district d ON d.id = c.district_id
      WHERE ch.deleted_at IS NULL
        AND ch.status = CAST(${'active'} AS child_status)
        AND ${this.districtIdFilter(districtIds)}
      GROUP BY c.district_id
    `;
    return new Map(rows.map((r) => [r.districtId, r.cnt]));
  }

  private async aggregateAttendanceByDistrict(
    districtIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, { present: number; absent: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ districtId: string; present: number; absent: number }>
    >`
      SELECT
        c.district_id AS "districtId",
        SUM(CASE WHEN ar.status = CAST(${'present'} AS attendance_status) THEN 1 ELSE 0 END)::int AS present,
        SUM(CASE WHEN ar.status = CAST(${'absent'} AS attendance_status) THEN 1 ELSE 0 END)::int AS absent
      FROM attendance_record ar
      INNER JOIN ecd_center c ON c.id = ar.center_id AND c.deleted_at IS NULL
      INNER JOIN district d ON d.id = c.district_id
      WHERE ar.deleted_at IS NULL
        AND ar.attendance_date >= ${from}
        AND ar.attendance_date <= ${to}
        AND ${this.districtIdFilter(districtIds)}
      GROUP BY c.district_id
    `;
    return new Map(rows.map((r) => [r.districtId, { present: r.present, absent: r.absent }]));
  }

  private async aggregateNutritionByDistrict(
    districtIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, { screenings: number; severe: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ districtId: string; screenings: number; severe: number }>
    >`
      SELECT
        c.district_id AS "districtId",
        COUNT(s.id)::int AS screenings,
        SUM(CASE WHEN s.nutrition_status = CAST(${'severe'} AS nutrition_status) THEN 1 ELSE 0 END)::int AS severe
      FROM child_nutrition_screening s
      INNER JOIN child ch ON ch.id = s.child_id AND ch.deleted_at IS NULL
      INNER JOIN ecd_center c ON c.id = ch.center_id AND c.deleted_at IS NULL
      INNER JOIN district d ON d.id = c.district_id
      WHERE s.deleted_at IS NULL
        AND s.screening_date >= ${from}
        AND s.screening_date <= ${to}
        AND ${this.districtIdFilter(districtIds)}
      GROUP BY c.district_id
    `;
    return new Map(rows.map((r) => [r.districtId, { screenings: r.screenings, severe: r.severe }]));
  }

  /** Open pipeline — not limited by the selected reporting period (matches dashboard/reports). */
  private async aggregatePendingReferralsByDistrict(
    districtIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ districtId: string; cnt: number }>>`
      SELECT c.district_id AS "districtId", COUNT(r.id)::int AS cnt
      FROM referral r
      INNER JOIN ecd_center c ON c.id = r.center_id AND c.deleted_at IS NULL
      INNER JOIN district d ON d.id = c.district_id
      WHERE r.deleted_at IS NULL
        AND r.status = CAST(${'pending'} AS referral_status)
        AND ${this.districtIdFilter(districtIds)}
      GROUP BY c.district_id
    `;
    return new Map(rows.map((r) => [r.districtId, r.cnt]));
  }

  private async aggregateStedByDistrict(
    districtIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, { assessmentsCompleted: number; childrenAssessed: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ districtId: string; assessmentsCompleted: number; childrenAssessed: number }>
    >`
      SELECT
        c.district_id AS "districtId",
        COUNT(s.id)::int AS "assessmentsCompleted",
        COUNT(DISTINCT s.child_id)::int AS "childrenAssessed"
      FROM sted_assessment s
      INNER JOIN ecd_center c ON c.id = s.center_id AND c.deleted_at IS NULL
      INNER JOIN district d ON d.id = c.district_id
      WHERE s.deleted_at IS NULL
        AND s.assessment_date >= ${from}
        AND s.assessment_date <= ${to}
        AND ${this.districtIdFilter(districtIds)}
      GROUP BY c.district_id
    `;
    return new Map(
      rows.map((r) => [
        r.districtId,
        {
          assessmentsCompleted: r.assessmentsCompleted,
          childrenAssessed: r.childrenAssessed,
        },
      ]),
    );
  }

  private async aggregateStedPendingFollowUpsByDistrict(
    districtIds: string[],
    to: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ districtId: string; cnt: number }>>`
      SELECT c.district_id AS "districtId", COUNT(s.id)::int AS cnt
      FROM sted_assessment s
      INNER JOIN ecd_center c ON c.id = s.center_id AND c.deleted_at IS NULL
      INNER JOIN district d ON d.id = c.district_id
      WHERE s.deleted_at IS NULL
        AND s.follow_up_in_6_months = true
        AND s.follow_up_due_date <= ${to}
        AND ${this.districtIdFilter(districtIds)}
      GROUP BY c.district_id
    `;
    return new Map(rows.map((r) => [r.districtId, r.cnt]));
  }
}
