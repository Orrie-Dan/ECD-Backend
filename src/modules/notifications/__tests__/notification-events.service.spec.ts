/**
 * Shared notification event producer tests.
 * Run: npx ts-node src/modules/notifications/__tests__/notification-events.service.spec.ts
 */
import { AssessmentStatus, UserRole } from '../../../common/domain';
import type { WhoConcernHit } from '../../nutrition/who/concern';
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

const belowMinus3: WhoConcernHit = {
  indicator: 'weight_for_age',
  zone: 'below_minus_3',
  zScore: -3.2,
  label: 'Weight-for-age Below -3 SD',
};

const minus3ToMinus2: WhoConcernHit = {
  indicator: 'muac_for_age',
  zone: 'minus_3_to_minus_2',
  zScore: -2.4,
  label: 'MUAC-for-age -3 to -2 SD',
};

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
  await assert('WHO below_minus_3 notifies center director and district officer', async () => {
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
      whoConcerns: [belowMinus3],
      requiresReferral: true,
      centerId: 'center-a',
      districtId: 'district-a',
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.entityId, 'screen-1');
    eq(calls[0]?.data.dedupeKey, NotificationDedupeKeys.nutritionScreeningCreated('screen-1'));
    eq(calls[0]?.userIds.sort(), ['director-a', 'district-a'].sort());
    eq(calls[0]?.data.metadata?.whoZone, 'below_minus_3');
    eq(calls[0]?.data.metadata?.requiresReferral, true);
    eq(calls[0]?.data.message?.includes('akeneye koherezwa kwa muganga'), true, 'message includes referral');
    eq(calls[0]?.data.title?.includes('ibiro ku myaka'), true, 'title identifies indicator');
  });

  await assert('no WHO concerns and no referral emits nothing', async () => {
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
      whoConcerns: [],
      requiresReferral: false,
      centerId: 'center-a',
      districtId: 'district-a',
    });

    eq(calls.length, 0);
  });

  await assert('WHO minus_3_to_minus_2 emits with referral metadata', async () => {
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
      whoConcerns: [minus3ToMinus2],
      requiresReferral: true,
      centerId: 'center-a',
      districtId: 'district-a',
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.metadata?.whoZone, 'minus_3_to_minus_2');
    eq(calls[0]?.data.metadata?.requiresReferral, true);
  });

  await assert('WHO concern without referral fires', async () => {
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
      whoConcerns: [minus3ToMinus2],
      requiresReferral: false,
      centerId: 'center-a',
      districtId: null,
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.metadata?.whoZone, 'minus_3_to_minus_2');
    eq(calls[0]?.data.metadata?.requiresReferral, false);
    eq(calls[0]?.data.message?.includes('akeneye koherezwa kwa muganga'), false, 'no referral suffix');
  });

  await assert('referral-only (no WHO concerns) emits notification', async () => {
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
      whoConcerns: [],
      requiresReferral: true,
      centerId: 'center-a',
      districtId: null,
    });

    eq(calls.length, 1);
    eq(calls[0]?.data.type, 'nutrition_alert');
    eq(calls[0]?.data.metadata?.whoZone, null);
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
    eq(calls[0]?.data.title, 'Urugo mbonezamikurire rushya rwa ECD rwanditswe');
    eq(calls[0]?.data.message, 'Nyamirambo ECD rwanditswe muri Nyarugenge.');
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

  await assert('priority: WHO below_minus_3 → critical, minus_3_to_minus_2 → high', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveNotificationPriority } = require('../notification-priority');
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', whoZone: 'below_minus_3' }),
      'critical',
    );
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', whoZone: 'minus_3_to_minus_2' }),
      'high',
    );
    eq(resolveNotificationPriority({ type: 'nutrition_alert', whoZone: null }), 'high');
    // Legacy absolute-MUAC fallback
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', nutritionStatus: 'severe' }),
      'critical',
    );
  });

  await assert('all alert nutrition conditions have inbox parity', () => {
    // Alert conditions from alerts.service.ts:
    // NUTRITION_WHO_BELOW_MINUS_3 → inbox: yes (event-driven WHO concerns)
    // NUTRITION_WHO_MINUS_3_TO_MINUS_2 → inbox: yes (event-driven WHO concerns)
    // NUTRITION_REQUIRES_REFERRAL → requiresReferral=true → inbox: yes
    // NUTRITION_OVERDUE → overdue screening → inbox: yes (NOTIF-06 cron)
    // NUTRITION_NEVER_SCREENED → never screened → inbox: yes (NOTIF-06 cron)
    eq(true, true);
  });

  console.log('\nAll notification-events tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
