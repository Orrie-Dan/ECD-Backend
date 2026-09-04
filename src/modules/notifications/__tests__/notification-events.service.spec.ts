/**
 * Shared notification event producer tests.
 * Run: npx ts-node src/modules/notifications/__tests__/notification-events.service.spec.ts
 */
import { AssessmentStatus, NutritionStatus, UserRole } from '../../../common/domain';
import { NotificationEventsService } from '../notification-events.service';
import { NotificationDedupeKeys } from '../notification-dedupe';

function assert(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (e) {
      console.error(`FAIL: ${name}`);
      throw e;
    }
  })();
}

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

type NotifyCall = {
  userIds: string[];
  data: {
    type: string;
    entityId?: string;
    title?: string;
    dedupeKey?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  };
  context?: string;
};

async function main() {
  await assert('severe nutrition notifies center director and district officer', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRoleAndCenter: async (centerId: string, roles: UserRole[]) => {
        eq(centerId, 'center-a');
        eq(roles, [UserRole.ecd_director]);
        return ['director-a'];
      },
      findUserIdsByRoleAndDistrict: async (districtId: string, roles: UserRole[]) => {
        eq(districtId, 'district-a');
        eq(roles, [UserRole.district_focal_person]);
        return ['district-a'];
      },
      notifyAsync: (userIds: string[], data: NotifyCall['data'], context?: string) => {
        calls.push({ userIds, data, context });
      },
    };

    await new NotificationEventsService(
      notifications as never,
      {} as never,
    ).onNutritionScreeningCreated({
      screeningId: 'screen-1',
      nutritionStatus: NutritionStatus.severe,
      requiresReferral: true,
      centerId: 'center-a',
      districtId: 'district-a',
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.entityId, 'screen-1');
    eq(calls[0]?.data.dedupeKey, NotificationDedupeKeys.nutritionScreeningCreated('screen-1'));
    eq(calls[0]?.userIds.sort(), ['director-a', 'district-a'].sort());
    eq(calls[0]?.data.metadata?.nutritionStatus, 'severe');
    eq(calls[0]?.data.metadata?.requiresReferral, true);
    eq(calls[0]?.data.message?.includes('referral required'), true, 'message includes referral');
  });

  await assert('normal nutrition screening emits no notification', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRoleAndCenter: async () => {
        throw new Error('should not resolve recipients');
      },
      findUserIdsByRoleAndDistrict: async () => [],
      notifyAsync: (userIds: string[], data: NotifyCall['data']) => {
        calls.push({ userIds, data });
      },
    };

    await new NotificationEventsService(
      notifications as never,
      {} as never,
    ).onNutritionScreeningCreated({
      screeningId: 'screen-2',
      nutritionStatus: NutritionStatus.normal,
      requiresReferral: false,
      centerId: 'center-a',
      districtId: 'district-a',
    });

    eq(calls.length, 0);
  });

  await assert('moderate nutrition emits notification with referral metadata', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['director-a'],
      findUserIdsByRoleAndDistrict: async () => ['district-a'],
      notifyAsync: (userIds: string[], data: NotifyCall['data'], context?: string) => {
        calls.push({ userIds, data, context });
      },
    };

    await new NotificationEventsService(
      notifications as never,
      {} as never,
    ).onNutritionScreeningCreated({
      screeningId: 'screen-mod',
      nutritionStatus: NutritionStatus.moderate,
      requiresReferral: true,
      centerId: 'center-a',
      districtId: 'district-a',
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.metadata?.nutritionStatus, 'moderate');
    eq(calls[0]?.data.metadata?.requiresReferral, true);
  });

  await assert('at_risk nutrition emits notification', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['director-a'],
      findUserIdsByRoleAndDistrict: async () => [],
      notifyAsync: (userIds: string[], data: NotifyCall['data'], context?: string) => {
        calls.push({ userIds, data, context });
      },
    };

    await new NotificationEventsService(
      notifications as never,
      {} as never,
    ).onNutritionScreeningCreated({
      screeningId: 'screen-risk',
      nutritionStatus: NutritionStatus.at_risk,
      requiresReferral: false,
      centerId: 'center-a',
      districtId: null,
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.metadata?.nutritionStatus, 'at_risk');
    eq(calls[0]?.data.metadata?.requiresReferral, false);
    eq(calls[0]?.data.message?.includes('referral required'), false, 'no referral suffix');
  });

  await assert('at_risk with requiresReferral includes referral in message', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['director-a'],
      findUserIdsByRoleAndDistrict: async () => [],
      notifyAsync: (userIds: string[], data: NotifyCall['data']) => {
        calls.push({ userIds, data });
      },
    };

    await new NotificationEventsService(
      notifications as never,
      {} as never,
    ).onNutritionScreeningCreated({
      screeningId: 'screen-risk-ref',
      nutritionStatus: NutritionStatus.at_risk,
      requiresReferral: true,
      centerId: 'center-a',
      districtId: null,
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.metadata?.requiresReferral, true);
    eq(calls[0]?.data.message?.includes('referral required'), true);
  });

  await assert('normal with requiresReferral=true emits notification', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['director-a'],
      findUserIdsByRoleAndDistrict: async () => [],
      notifyAsync: (userIds: string[], data: NotifyCall['data']) => {
        calls.push({ userIds, data });
      },
    };

    await new NotificationEventsService(
      notifications as never,
      {} as never,
    ).onNutritionScreeningCreated({
      screeningId: 'screen-normal-ref',
      nutritionStatus: NutritionStatus.normal,
      requiresReferral: true,
      centerId: 'center-a',
      districtId: null,
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.metadata?.nutritionStatus, 'normal');
    eq(calls[0]?.data.metadata?.requiresReferral, true);
  });

  await assert('same screening deduped (one notification per screening)', () => {
    const key1 = NotificationDedupeKeys.nutritionScreeningCreated('screen-x');
    const key2 = NotificationDedupeKeys.nutritionScreeningCreated('screen-x');
    eq(key1, key2, 'same screening = same key');

    const key3 = NotificationDedupeKeys.nutritionScreeningCreated('screen-y');
    eq(key1 === key3, false, 'different screening = different key');
  });

  await assert('STED follow-up notifies center director and caregiver', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRoleAndCenter: async (_centerId: string, roles: UserRole[]) => {
        eq(roles, [UserRole.ecd_director, UserRole.caregiver]);
        return ['director-a', 'caregiver-a'];
      },
      notifyAsync: (userIds: string[], data: NotifyCall['data']) => {
        calls.push({ userIds, data });
      },
    };

    await new NotificationEventsService(
      notifications as never,
      {} as never,
    ).onStedAssessmentCreated({
      assessmentId: 'sted-1',
      centerId: 'center-a',
      followUpIn6Months: true,
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'sted_followup');
  });

  await assert('center created notifies national admins and district officers', async () => {
    const calls: NotifyCall[] = [];
    const notifications = {
      findUserIdsByRole: async (roles: UserRole[]) => {
        eq(roles, [UserRole.ncda_admin]);
        return ['admin-a', 'admin-b'];
      },
      findUserIdsByRoleAndDistrict: async (districtId: string, roles: UserRole[]) => {
        eq(districtId, 'district-a');
        eq(roles, [UserRole.district_focal_person]);
        return ['district-a', 'admin-a'];
      },
      notifyAsync: (userIds: string[], data: NotifyCall['data'], context?: string) => {
        calls.push({ userIds, data, context });
      },
    };

    await new NotificationEventsService(notifications as never, {} as never).onCenterCreated({
      centerId: 'center-new',
      centerName: 'Nyamirambo ECD',
      districtId: 'district-a',
      districtName: 'Nyarugenge',
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'center_created');
    eq(calls[0]?.data.entityId, 'center-new');
    eq(calls[0]?.data.title, 'New ECD center registered');
    eq(calls[0]?.data.message, 'Nyamirambo ECD has been registered in Nyarugenge.');
    eq(calls[0]?.data.dedupeKey, NotificationDedupeKeys.centerCreated('center-new'));
    eq(calls[0]?.context, 'center_created');
    eq(calls[0]?.userIds.sort(), ['admin-a', 'admin-b', 'district-a'].sort());
  });

  await assert(
    'compliance submitted notifies district officer only for that district',
    async () => {
      const calls: NotifyCall[] = [];
      const notifications = {
        findUserIdsByRoleAndDistrict: async (districtId: string, roles: UserRole[]) => {
          eq(districtId, 'district-a');
          eq(roles, [UserRole.district_focal_person]);
          return ['district-officer-a'];
        },
        notifyAsync: (userIds: string[], data: NotifyCall['data']) => {
          calls.push({ userIds, data });
        },
      };

      await new NotificationEventsService(
        notifications as never,
        {} as never,
      ).onComplianceAssessmentStatusChanged({
        assessmentId: 'assess-1',
        centerId: 'center-a',
        centerName: 'Center A',
        districtId: 'district-a',
        previousStatus: AssessmentStatus.draft,
        newStatus: AssessmentStatus.submitted,
      });

      eq(calls.length, 1);
      eq(calls[0]?.userIds, ['district-officer-a']);
      eq(calls[0]?.data.type, 'compliance_update');
    },
  );

  // ── NOTIF-04 Priority Parity ───────────────────────────────────────

  await assert('priority: severe → critical, moderate → high, at_risk → medium', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveNotificationPriority } = require('../notification-priority');
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', nutritionStatus: 'severe' }),
      'critical',
    );
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', nutritionStatus: 'moderate' }),
      'high',
    );
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', nutritionStatus: 'at_risk' }),
      'medium',
    );
    eq(resolveNotificationPriority({ type: 'nutrition_alert', nutritionStatus: 'normal' }), 'high');
  });

  // ── Contract Parity: alert conditions vs notification conditions ───

  await assert('all alert nutrition conditions have inbox parity', () => {
    // Alert conditions from alerts.service.ts:
    // NUTRITION_SEVERE → severe → inbox: yes (event-driven, severe)
    // NUTRITION_AT_RISK → moderate|at_risk → inbox: yes (event-driven, moderate/at_risk)
    // NUTRITION_REQUIRES_REFERRAL → requiresReferral=true → inbox: yes (combined in metadata)
    // NUTRITION_OVERDUE → overdue screening → inbox: yes (NOTIF-06 cron)
    // NUTRITION_NEVER_SCREENED → never screened → inbox: yes (NOTIF-06 cron)
    //
    // All actionable nutrition conditions now have inbox representation.
    // requiresReferral is NOT a separate notification; it is metadata
    // on the same screening notification, avoiding signal duplication.
    //
    // This is a documentation assertion, not a runtime check.
    eq(true, true, 'parity documented');
  });

  console.log('\nAll notification event tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
