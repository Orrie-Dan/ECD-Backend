import { Injectable, Logger } from '@nestjs/common';
import { EmailTemplateId, EmailTemplatePayload } from './email-template.ids';
import { renderEmailTemplate } from './email-template.registry';
import { EmailSendContext, EmailSendResult } from './email.types';
import { formatDeliveryError } from './log-error.util';
import { SmtpEmailService } from './smtp-email.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly smtp: SmtpEmailService) {}

  isConfigured(): boolean {
    return this.smtp.isConfigured();
  }

  /** Best-effort: never throws; logs failures. */
  async sendBestEffort(
    to: string | undefined | null,
    templateId: EmailTemplateId,
    payload: EmailTemplatePayload,
    context?: EmailSendContext,
  ): Promise<EmailSendResult> {
    if (!to?.trim()) {
      return { sent: false, skipped: true, reason: 'no_recipient' };
    }
    if (!this.smtp.isConfigured()) {
      this.logger.debug(
        `Email skipped (SMTP not configured): ${templateId} ${context?.entityId ?? ''}`,
      );
      return { sent: false, skipped: true, reason: 'smtp_not_configured' };
    }

    const recipient = to.trim();
    const { subject, text, html } = renderEmailTemplate(templateId, payload);
    try {
      await this.smtp.sendMail({ to: recipient, subject, text, html });
      this.logger.log(
        `Email sent: ${templateId} to=${recipient} entity=${context?.entityType ?? ''}/${context?.entityId ?? ''}`,
      );
      return { sent: true };
    } catch (err) {
      this.logger.warn(
        `Email failed (best-effort): ${templateId} to=${recipient} — ${formatDeliveryError(err)}`,
      );
      return { sent: false, reason: 'send_failed' };
    }
  }
}
