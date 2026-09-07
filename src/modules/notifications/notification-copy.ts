import { AssessmentStatus, NutritionStatus, UserRole } from '../../common/domain';

/** Kinyarwanda UI copy for persisted notification title/message fields. */

const NUTRITION_STATUS_LABEL: Record<string, string> = {
  [NutritionStatus.severe]: 'imirire mibi ikabije',
  [NutritionStatus.moderate]: 'imirire mibi yo hagati',
  [NutritionStatus.at_risk]: 'ibyago byo kugira imirire mibi',
  [NutritionStatus.normal]: 'imirire myiza',
  // English display form after replace('_',' ')
  'at risk': 'ibyago byo kugira imirire mibi',
};

const REFERRAL_SOURCE_LABEL: Record<string, string> = {
  nutrition: 'imirire',
  sted: 'isuzuma rya STED',
};

const REFERRAL_STATUS_LABEL: Record<string, string> = {
  pending: 'bitegereje gukurikiranwa',
  completed: 'byarangiye',
  cancelled: 'byahagaritswe',
};

const USER_ROLE_LABEL: Record<string, string> = {
  [UserRole.caregiver]: 'Umurezi',
  [UserRole.ecd_director]: "Umuyobozi w'ikigo cya ECD",
  [UserRole.district_focal_person]: 'Ushinzwe ECD ku karere',
  [UserRole.ncda_admin]: 'Umuyobozi wa NCDA',
};

const REFERRAL_REQUIRED_SUFFIX = ' — akeneye koherezwa kwa muganga';
const FALLBACK_CHILD_NAME = 'umwana';

export function formatChildDisplayName(
  firstName: string | null | undefined,
  lastName?: string | null,
): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || FALLBACK_CHILD_NAME;
}

export function nutritionStatusLabel(status: string): string {
  return NUTRITION_STATUS_LABEL[status] ?? status.replace('_', ' ');
}

export function referralSourceLabel(sourceType: string): string {
  return REFERRAL_SOURCE_LABEL[sourceType] ?? sourceType;
}

export function referralStatusLabel(status: string): string {
  return REFERRAL_STATUS_LABEL[status] ?? status;
}

export function userRoleLabel(role: string): string {
  return USER_ROLE_LABEL[role] ?? role;
}

export const NotificationCopy = {
  nutritionAlert(status: string, requiresReferral: boolean) {
    const statusLabel = nutritionStatusLabel(status);
    const referralSuffix = requiresReferral ? REFERRAL_REQUIRED_SUFFIX : '';
    return {
      title: `Isuzuma ry'imirire: ${statusLabel}`,
      message: `Umwana yasuzumwe imirire, asanga afite ${statusLabel}${referralSuffix}.`,
    };
  },

  stedFollowUpCreated: {
    title: 'Gukurikirana isuzuma rya STED byateganyijwe',
    message: "Isuzuma rya STED risaba ko umwana yongera gukurikiranwa nyuma y'amezi 6.",
  },

  referralCreated(sourceType: string) {
    return {
      title: 'Koherezwa kwa muganga gushya',
      message: `Hakozwe koherezwa kwa muganga gushya gushingiye kuri ${referralSourceLabel(sourceType)}.`,
    };
  },

  referralUpdated(status: string) {
    return {
      title: 'Imiterere yo koherezwa kwa muganga yahinduwe',
      message: `Koherezwa kwa muganga kwahinduwe gushyirwa kuri ${referralStatusLabel(status)}.`,
    };
  },

  centerCreated(centerName: string, districtName?: string | null) {
    const districtSuffix = districtName ? ` muri ${districtName}` : '';
    return {
      title: 'Ikigo gishya cya ECD cyanditswe',
      message: `${centerName} cyanditswe${districtSuffix}.`,
    };
  },

  childEnrolled(firstName: string, lastName: string | null) {
    const name = formatChildDisplayName(firstName, lastName);
    return {
      title: 'Umwana mushya yanditswe',
      message: `${name} yanditswe mu kigo.`,
    };
  },

  childArchived(firstName: string, lastName: string | null) {
    const name = formatChildDisplayName(firstName, lastName);
    return {
      title: 'Umwana yashyizwe mu bubiko',
      message: `${name} yashyizwe mu bubiko.`,
    };
  },

  transferRequested(childFirstName: string | null) {
    const name = childFirstName?.trim() || FALLBACK_CHILD_NAME;
    return {
      title: `Ubusabe bwo kwimura ${name}`,
      message: 'Hasabwe ko umwana yimurirwa mu kigo cyawe.',
    };
  },

  transferAccepted: {
    title: 'Kwimura umwana byemejwe',
    message: "Ubusabe bwawe bwo kwimura umwana bwemejwe n'ikigo agiyemo.",
  },

  transferCancelled: {
    title: 'Kwimura umwana byahagaritswe',
    message: 'Kwimurira umwana mu kigo cyawe byahagaritswe.',
  },

  complianceSubmitted(centerName: string) {
    return {
      title: "Isuzuma ry'iyubahirizwa ryatanzwe",
      message: `Isuzuma ry'iyubahirizwa rya ${centerName} ryatanzwe kugira ngo risuzumwe.`,
    };
  },

  complianceVerifiedOrRejected(newStatus: AssessmentStatus.verified | AssessmentStatus.rejected) {
    if (newStatus === AssessmentStatus.verified) {
      return {
        title: "Isuzuma ry'iyubahirizwa ryemejwe",
        message: "Isuzuma ry'iyubahirizwa ryawe ryemejwe.",
      };
    }
    return {
      title: "Isuzuma ry'iyubahirizwa ryanzwe",
      message: "Isuzuma ry'iyubahirizwa ryawe ryanzwe.",
    };
  },

  userProvisioned(fullName: string, role: string) {
    return {
      title: 'Umukoresha mushya yongewemo',
      message: `${fullName} (${userRoleLabel(role)}) yongewemo mu kigo cyawe.`,
    };
  },

  // ── Daily cron ──────────────────────────────────────────────────────

  stedFollowUpDueSoon(childName: string, dueDate: string) {
    return {
      title: 'Igihe cyo gukurikirana STED kiregereje',
      message: `Gukurikirana isuzuma rya STED rya ${childName} biteganyijwe ku wa ${dueDate}.`,
    };
  },

  complianceGapOverdue(standardTitle: string, centerName: string) {
    return {
      title: 'Icyuho mu iyubahirizwa cyarengeje igihe',
      message: `Icyuho cya ${standardTitle} kuri ${centerName} cyarengeje igihe cyari cyateganyijwe kugikemura.`,
    };
  },

  staleTransferReminder(childName: string) {
    return {
      title: 'Kwibutsa ubusabe bwo kwimura butaremezwa',
      message: `Kwimura ${childName} bimaze iminsi 7 cyangwa irenga bitegereje kwemezwa.`,
    };
  },

  staleReferralFollowUp(childName: string, ageDays: number) {
    return {
      title: 'Koherezwa kwa muganga gutegereje gukurikiranwa',
      message: `Koherezwa kwa muganga kwa ${childName} kumaze iminsi ${ageDays} gutegereje gukurikiranwa.`,
    };
  },

  nutritionNeverScreened(childName: string) {
    return {
      title: "Isuzuma ry'imirire rirakenewe",
      message: `${childName} ntarigera asuzumwa imirire.`,
    };
  },

  nutritionOverdue(childName: string, lastScreeningDate: string) {
    return {
      title: "Isuzuma ry'imirire ryarengeje igihe",
      message: `${childName} amaze iminsi 30 cyangwa irenga adasuzumwa imirire (aheruka: ${lastScreeningDate}).`,
    };
  },

  capacityWarning(centerName: string, count: number, capacity: number) {
    return {
      title: 'Ikigo cyageze ku mubare ntarengwa',
      message: `${centerName} gifite abana ${count} (ubushobozi: ${capacity}).`,
    };
  },

  attendanceAbsence(childName: string, absentDays: number) {
    return {
      title: 'Gusiba kenshi',
      message: `${childName} yasibye iminsi ${absentDays} mu minsi 7 ishize.`,
    };
  },

  attendanceLowRate(centerName: string, rate: number) {
    return {
      title: 'Ubwitabire buri hasi',
      message: `Ubwitabire muri ${centerName} ni ${rate}% mu minsi 7 ishize.`,
    };
  },
} as const;
