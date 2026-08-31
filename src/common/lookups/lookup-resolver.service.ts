import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeLookupCode } from './normalize-lookup-code';

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class LookupResolverService implements OnModuleInit {
  private readonly logger = new Logger(LookupResolverService.name);
  private readonly enumCache = new Map<string, Map<string, string>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** Reload all enum-backed lookup tables into memory. */
  async reload(): Promise<void> {
    const [
      ecdCenterStatus,
      complianceClassification,
      administrativeLevel,
      nutritionStatus,
      assessmentType,
      assessmentStatus,
      itemResponse,
      gapSeverity,
      gapStatus,
      standardDomain,
      childGender,
      childStatus,
      attendanceStatus,
      absentReason,
      stedAgeBand,
      referralSourceType,
      referralStatus,
      transferStatus,
      classroomGrade,
      parentContributionType,
      inKindItemType,
      centerSupportCategory,
    ] = await Promise.all([
      this.prisma.lookupEcdCenterStatus.findMany(),
      this.prisma.lookupComplianceClassification.findMany(),
      this.prisma.lookupAdministrativeLevel.findMany(),
      this.prisma.lookupNutritionStatus.findMany(),
      this.prisma.lookupAssessmentType.findMany(),
      this.prisma.lookupAssessmentStatus.findMany(),
      this.prisma.lookupItemResponse.findMany(),
      this.prisma.lookupGapSeverity.findMany(),
      this.prisma.lookupGapStatus.findMany(),
      this.prisma.lookupStandardDomain.findMany(),
      this.prisma.lookupChildGender.findMany(),
      this.prisma.lookupChildStatus.findMany(),
      this.prisma.lookupAttendanceStatus.findMany(),
      this.prisma.lookupAbsentReason.findMany(),
      this.prisma.lookupStedAgeBand.findMany(),
      this.prisma.lookupReferralSourceType.findMany(),
      this.prisma.lookupReferralStatus.findMany(),
      this.prisma.lookupTransferStatus.findMany(),
      this.prisma.lookupClassroomGrade.findMany(),
      this.prisma.lookupParentContributionType.findMany(),
      this.prisma.lookupInKindItemType.findMany(),
      this.prisma.lookupCenterSupportCategory.findMany(),
    ]);

    this.enumCache.set('ecdCenterStatus', this.toCodeMap(ecdCenterStatus));
    this.enumCache.set('complianceClassification', this.toCodeMap(complianceClassification));
    this.enumCache.set('administrativeLevel', this.toCodeMap(administrativeLevel));
    this.enumCache.set('nutritionStatus', this.toCodeMap(nutritionStatus));
    this.enumCache.set('assessmentType', this.toCodeMap(assessmentType));
    this.enumCache.set('assessmentStatus', this.toCodeMap(assessmentStatus));
    this.enumCache.set('itemResponse', this.toCodeMap(itemResponse));
    this.enumCache.set('gapSeverity', this.toCodeMap(gapSeverity));
    this.enumCache.set('gapStatus', this.toCodeMap(gapStatus));
    this.enumCache.set('standardDomain', this.toCodeMap(standardDomain));
    this.enumCache.set('childGender', this.toCodeMap(childGender));
    this.enumCache.set('childStatus', this.toCodeMap(childStatus));
    this.enumCache.set('attendanceStatus', this.toCodeMap(attendanceStatus));
    this.enumCache.set('absentReason', this.toCodeMap(absentReason));
    this.enumCache.set('stedAgeBand', this.toCodeMap(stedAgeBand));
    this.enumCache.set('referralSourceType', this.toCodeMap(referralSourceType));
    this.enumCache.set('referralStatus', this.toCodeMap(referralStatus));
    this.enumCache.set('transferStatus', this.toCodeMap(transferStatus));
    this.enumCache.set('classroomGrade', this.toCodeMap(classroomGrade));
    this.enumCache.set('parentContributionType', this.toCodeMap(parentContributionType));
    this.enumCache.set('inKindItemType', this.toCodeMap(inKindItemType));
    this.enumCache.set('centerSupportCategory', this.toCodeMap(centerSupportCategory));

    this.logger.log(`Loaded ${this.enumCache.size} GIS lookup caches`);
  }

  private toCodeMap(rows: { id: string; code: string }[]): Map<string, string> {
    return new Map(rows.map((row) => [row.code, row.id]));
  }

  requireEnumId(cacheKey: string, code: string): string {
    const id = this.enumCache.get(cacheKey)?.get(code);
    if (!id) {
      throw new Error(`Unknown lookup code ${cacheKey}.${code}`);
    }
    return id;
  }

  optionalEnumId(cacheKey: string, code: string | null | undefined): string | null | undefined {
    if (code === undefined) return undefined;
    if (code == null) return null;
    return this.requireEnumId(cacheKey, code);
  }

  /** Upsert coded-string lookup (meal quality, food source, water source type). */
  async resolveCodedLookupId(
    db: DbClient,
    table: 'mealQuality' | 'foodSource' | 'waterSourceType',
    raw: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw == null || raw.trim() === '') return null;

    const label = raw.trim();
    const code = normalizeLookupCode(label);

    if (table === 'mealQuality') {
      const row = await db.lookupMealQuality.upsert({
        where: { code },
        create: { code, labelEn: label },
        update: {},
        select: { id: true },
      });
      return row.id;
    }

    if (table === 'foodSource') {
      const row = await db.lookupFoodSource.upsert({
        where: { code },
        create: { code, labelEn: label },
        update: {},
        select: { id: true },
      });
      return row.id;
    }

    const row = await db.lookupWaterSourceType.upsert({
      where: { code },
      create: { code, labelEn: label },
      update: {},
      select: { id: true },
    });
    return row.id;
  }
}
