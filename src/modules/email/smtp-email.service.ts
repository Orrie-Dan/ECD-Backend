import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SendMailPayload } from './email.types';
import { formatSmtpError } from './log-error.util';

@Injectable()
export class SmtpEmailService implements OnModuleDestroy {
  private readonly logger = new Logger(SmtpEmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SMTP_HOST')?.trim() && this.config.get<string>('SMTP_FROM')?.trim(),
    );
  }

  async sendMail({ to, subject, text, html }: SendMailPayload): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const port = Number(this.config.get<string>('SMTP_PORT', '587'));
    const from = this.config.get<string>('SMTP_FROM')?.trim();

    if (!host || !port || !from) {
      throw new HttpException('SMTP delivery is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const transporter = this.getTransporter(host, port);

    this.logger.debug(`SMTP sending to=${to} from=${from} host=${host}:${port} subject="${subject}"`);

    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        ...(html ? { html } : {}),
      });
      this.logger.log(`SMTP sent to=${to} messageId=${info.messageId ?? 'n/a'}`);
    } catch (err) {
      const { message, response } = formatSmtpError(err);
      this.logger.warn(
        `SMTP send failed to=${to} from=${from} host=${host}:${port} — ${message}${
          response ? ` | ${response}` : ''
        }`,
      );
      throw new HttpException('Failed to send email', HttpStatus.BAD_GATEWAY);
    }
  }

  onModuleDestroy(): void {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
  }

  private getTransporter(host: string, port: number): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const secure = this.config.get<string>('SMTP_SECURE', 'false') === 'true';
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    return this.transporter;
  }
}
