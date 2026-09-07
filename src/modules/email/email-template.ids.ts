/** Stable template keys for transactional email. */
export enum EmailTemplateId {
  SECURITY_PASSWORD_RESET_REQUESTED = 'security.passwordResetRequested',
  SECURITY_PASSWORD_RESET_COMPLETED = 'security.passwordResetCompleted',
  SECURITY_ACCOUNT_PROVISIONED = 'security.accountProvisioned',
}

export type EmailTemplatePayload = Record<string, string | number | undefined>;
