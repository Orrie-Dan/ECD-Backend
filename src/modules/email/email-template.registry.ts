import { EmailTemplateId, EmailTemplatePayload } from './email-template.ids';
import { buildRenderedEmail } from './email-layout';

export type RenderedEmail = { subject: string; text: string; html: string };

export function renderEmailTemplate(
  templateId: EmailTemplateId,
  payload: EmailTemplatePayload,
): RenderedEmail {
  const name = String(payload.fullName ?? 'there');
  const resetUrl = String(payload.resetUrl ?? '').trim();

  switch (templateId) {
    case EmailTemplateId.SECURITY_PASSWORD_RESET_REQUESTED:
      return buildRenderedEmail('Reset your ECD password', {
        greetingName: name,
        paragraphs: [
          'A password reset was requested for your ECD account.',
          resetUrl
            ? 'Use the button below or paste the link into your browser. This link expires in 1 hour.'
            : 'Use the reset token below with the password-reset confirm API. This token expires in 1 hour.',
          'If you did not request this, you can ignore this email.',
        ],
        action: resetUrl ? { label: 'Reset password', url: resetUrl } : undefined,
        callouts: resetUrl
          ? [{ label: 'Reset link', value: resetUrl }]
          : payload.resetToken
            ? [{ label: 'Reset token', value: String(payload.resetToken) }]
            : undefined,
        footerNote: 'Do not share this link or token with anyone.',
      });

    case EmailTemplateId.SECURITY_PASSWORD_RESET_COMPLETED:
      return buildRenderedEmail('Your ECD password was reset', {
        greetingName: name,
        paragraphs: [
          'Your password was successfully reset.',
          'If you did not make this change, contact your administrator immediately.',
        ],
      });

    case EmailTemplateId.SECURITY_ACCOUNT_PROVISIONED: {
      const username = String(payload.username ?? '').trim();
      const temporaryPassword = String(payload.temporaryPassword ?? '').trim();
      const loginUrl = String(payload.loginUrl ?? '').trim();
      return buildRenderedEmail('Your ECD account credentials', {
        greetingName: name,
        paragraphs: [
          'An ECD account was created for you.',
          'Sign in with the username and temporary password below. You will be asked to change the password after your first login.',
          'If you were not expecting this account, contact your administrator.',
        ],
        callouts: [
          ...(username ? [{ label: 'Username', value: username }] : []),
          ...(temporaryPassword
            ? [{ label: 'Temporary password', value: temporaryPassword }]
            : []),
        ],
        action: loginUrl ? { label: 'Sign in', url: loginUrl } : undefined,
        footerNote: 'Do not share this password with anyone.',
      });
    }

    default: {
      const exhaustive: never = templateId;
      throw new Error(`Unknown email template: ${exhaustive}`);
    }
  }
}
