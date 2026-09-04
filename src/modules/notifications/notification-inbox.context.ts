import { Notification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationContextDto } from './dto/notification-response.dto';
import { NotificationMapperExtras } from './mappers/notification.mapper';

type NamedChild = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  centerId: string;
};

type NamedCenter = {
  id: string;
  name: string;
  districtId: string;
  district: { id: string; name: string } | null;
};

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((id): id is string => !!id))];
}

export function formatNotificationChildName(
  firstName: string,
  middleName?: string | null,
  lastName?: string | null,
): string {
  return [firstName, middleName, lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(' ');
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function metaString(metadata: Record<string, unknown> | null, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function buildContext(input: {
  child?: NamedChild;
  center?: NamedCenter;
  fallbackChild?: { id: string; name: string };
  fallbackCenter?: { id: string; name: string };
}): NotificationContextDto {
  const context: NotificationContextDto = {};
  if (input.child) {
    context.child = {
      id: input.child.id,
      name: formatNotificationChildName(
        input.child.firstName,
        input.child.middleName,
        input.child.lastName,
      ),
    };
  } else if (input.fallbackChild) {
    context.child = input.fallbackChild;
  }

  if (input.center) {
    context.center = { id: input.center.id, name: input.center.name };
    if (input.center.district) {
      context.district = {
        id: input.center.district.id,
        name: input.center.district.name,
      };
    }
  } else if (input.fallbackCenter) {
    context.center = input.fallbackCenter;
  }

  return context;
}

function idsByEntityType(rows: Notification[], entityType: string): string[] {
  return uniqueIds(rows.filter((row) => row.entityType === entityType).map((row) => row.entityId));
}

/**
 * Batch-loads lightweight child/center/district context for a page of notifications.
 * Missing related records leave context fields unset — the inbox still renders.
 */
export async function loadNotificationInboxExtras(
  prisma: PrismaService,
  rows: Notification[],
): Promise<Map<string, NotificationMapperExtras>> {
  const extras = new Map<string, NotificationMapperExtras>();
  if (rows.length === 0) {
    return extras;
  }

  const screeningIds = idsByEntityType(rows, 'child_nutrition_screening');
  const stedIds = idsByEntityType(rows, 'sted_assessment');
  const referralIds = idsByEntityType(rows, 'referral');
  const transferIds = idsByEntityType(rows, 'child_transfer');
  const assessmentIds = idsByEntityType(rows, 'compliance_assessment');
  const itemIds = idsByEntityType(rows, 'compliance_assessment_item');
  const directChildIds = idsByEntityType(rows, 'child');
  const directCenterIds = idsByEntityType(rows, 'ecd_center');

  const [screenings, stedRows, referrals, transfers, assessments, items] = await Promise.all([
    screeningIds.length
      ? prisma.childNutritionScreening.findMany({
          where: { id: { in: screeningIds } },
          select: { id: true, childId: true, nutritionStatus: true },
        })
      : Promise.resolve([]),
    stedIds.length
      ? prisma.stedAssessment.findMany({
          where: { id: { in: stedIds } },
          select: { id: true, childId: true, centerId: true },
        })
      : Promise.resolve([]),
    referralIds.length
      ? prisma.referral.findMany({
          where: { id: { in: referralIds } },
          select: { id: true, childId: true, centerId: true },
        })
      : Promise.resolve([]),
    transferIds.length
      ? prisma.childTransfer.findMany({
          where: { id: { in: transferIds } },
          select: { id: true, childId: true, fromCenterId: true, toCenterId: true },
        })
      : Promise.resolve([]),
    assessmentIds.length
      ? prisma.complianceAssessment.findMany({
          where: { id: { in: assessmentIds } },
          select: { id: true, centerId: true },
        })
      : Promise.resolve([]),
    itemIds.length
      ? prisma.complianceAssessmentItem.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true,
            assessmentId: true,
            assessment: { select: { id: true, centerId: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const screeningById = new Map(screenings.map((row) => [row.id, row]));
  const stedById = new Map(stedRows.map((row) => [row.id, row]));
  const referralById = new Map(referrals.map((row) => [row.id, row]));
  const transferById = new Map(transfers.map((row) => [row.id, row]));
  const assessmentById = new Map(assessments.map((row) => [row.id, row]));
  const itemById = new Map(items.map((row) => [row.id, row]));

  const childIds = uniqueIds([
    ...directChildIds,
    ...screenings.map((row) => row.childId),
    ...stedRows.map((row) => row.childId),
    ...referrals.map((row) => row.childId),
    ...transfers.map((row) => row.childId),
    ...rows.map((row) => metaString(metadataRecord(row.metadata), 'childId')),
  ]);

  const children = childIds.length
    ? await prisma.child.findMany({
        where: { id: { in: childIds } },
        select: { id: true, firstName: true, middleName: true, lastName: true, centerId: true },
      })
    : [];
  const childById = new Map(children.map((row) => [row.id, row]));

  const centerIds = uniqueIds([
    ...directCenterIds,
    ...stedRows.map((row) => row.centerId),
    ...referrals.map((row) => row.centerId),
    ...transfers.map((row) => row.toCenterId),
    ...transfers.map((row) => row.fromCenterId),
    ...assessments.map((row) => row.centerId),
    ...items.map((row) => row.assessment.centerId),
    ...children.map((row) => row.centerId),
  ]);

  const centers = centerIds.length
    ? await prisma.ecdCenter.findMany({
        where: { id: { in: centerIds } },
        select: {
          id: true,
          name: true,
          districtId: true,
          district: { select: { id: true, name: true } },
        },
      })
    : [];
  const centerById = new Map(centers.map((row) => [row.id, row]));

  for (const row of rows) {
    extras.set(
      row.id,
      extrasForRow(row, {
        screeningById,
        stedById,
        referralById,
        transferById,
        assessmentById,
        itemById,
        childById,
        centerById,
      }),
    );
  }

  return extras;
}

function extrasForRow(
  row: Notification,
  maps: {
    screeningById: Map<string, { id: string; childId: string; nutritionStatus: string }>;
    stedById: Map<string, { id: string; childId: string; centerId: string }>;
    referralById: Map<string, { id: string; childId: string; centerId: string }>;
    transferById: Map<
      string,
      { id: string; childId: string; fromCenterId: string; toCenterId: string }
    >;
    assessmentById: Map<string, { id: string; centerId: string }>;
    itemById: Map<
      string,
      { id: string; assessmentId: string; assessment: { id: string; centerId: string } }
    >;
    childById: Map<string, NamedChild>;
    centerById: Map<string, NamedCenter>;
  },
): NotificationMapperExtras {
  const metadata = metadataRecord(row.metadata);
  const entityId = row.entityId ?? '';
  let childId: string | null = null;
  let centerId: string | null = null;
  let assessmentId: string | null = null;
  let nutritionStatus: string | null = null;

  if (row.entityType === 'child') {
    childId = entityId;
  } else if (row.entityType === 'ecd_center') {
    centerId = entityId;
  } else if (row.entityType === 'child_nutrition_screening') {
    const screening = maps.screeningById.get(entityId);
    childId = screening?.childId ?? null;
    nutritionStatus = screening?.nutritionStatus ?? null;
  } else if (row.entityType === 'sted_assessment') {
    const sted = maps.stedById.get(entityId);
    childId = sted?.childId ?? null;
    centerId = sted?.centerId ?? null;
  } else if (row.entityType === 'referral') {
    const referral = maps.referralById.get(entityId);
    childId = referral?.childId ?? null;
    centerId = referral?.centerId ?? null;
  } else if (row.entityType === 'child_transfer') {
    const transfer = maps.transferById.get(entityId);
    childId = transfer?.childId ?? null;
    centerId =
      row.type === 'transfer_accepted'
        ? (transfer?.fromCenterId ?? null)
        : (transfer?.toCenterId ?? transfer?.fromCenterId ?? null);
  } else if (row.entityType === 'compliance_assessment') {
    assessmentId = entityId;
    centerId = maps.assessmentById.get(entityId)?.centerId ?? null;
  } else if (row.entityType === 'compliance_assessment_item') {
    const item = maps.itemById.get(entityId);
    assessmentId = item?.assessmentId ?? null;
    centerId = item?.assessment.centerId ?? null;
  }

  childId = childId ?? metaString(metadata, 'childId') ?? null;
  const child = childId ? maps.childById.get(childId) : undefined;
  if (!centerId && child) {
    centerId = child.centerId;
  }

  const center = centerId ? maps.centerById.get(centerId) : undefined;
  const fallbackChildName = metaString(metadata, 'childName');
  const fallbackCenterName = metaString(metadata, 'centerName');

  return {
    childId,
    centerId,
    assessmentId,
    nutritionStatus,
    context: buildContext({
      child,
      center,
      fallbackChild:
        !child && childId && fallbackChildName
          ? { id: childId, name: fallbackChildName }
          : undefined,
      fallbackCenter:
        !center && centerId && fallbackCenterName
          ? { id: centerId, name: fallbackCenterName }
          : undefined,
    }),
  };
}
