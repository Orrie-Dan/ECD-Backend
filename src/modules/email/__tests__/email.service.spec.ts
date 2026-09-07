/**
 * EmailService best-effort delivery tests.
 * Run: npx ts-node src/modules/email/__tests__/email.service.spec.ts
 */
import { EmailService } from '../email.service';
import { EmailTemplateId } from '../email-template.ids';
import { SmtpEmailService } from '../smtp-email.service';

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

async function run() {
  let passed = 0;
  let failed = 0;

  const assert = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed += 1;
      console.log(`PASS: ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`FAIL: ${name}`);
      console.error(e);
    }
  };

  await assert('skips when no recipient', async () => {
    const calls: unknown[] = [];
    const smtp = {
      isConfigured: () => true,
      sendMail: async (payload: unknown) => {
        calls.push(payload);
      },
    } as unknown as SmtpEmailService;
    const service = new EmailService(smtp);
    const result = await service.sendBestEffort(null, EmailTemplateId.SECURITY_PASSWORD_RESET_COMPLETED, {});
    eq(result, { sent: false, skipped: true, reason: 'no_recipient' });
    eq(calls.length, 0);
  });

  await assert('skips when SMTP is not configured', async () => {
    const calls: unknown[] = [];
    const smtp = {
      isConfigured: () => false,
      sendMail: async (payload: unknown) => {
        calls.push(payload);
      },
    } as unknown as SmtpEmailService;
    const service = new EmailService(smtp);
    const result = await service.sendBestEffort(
      'user@example.com',
      EmailTemplateId.SECURITY_PASSWORD_RESET_COMPLETED,
      { fullName: 'Test' },
    );
    eq(result, { sent: false, skipped: true, reason: 'smtp_not_configured' });
    eq(calls.length, 0);
  });

  await assert('does not throw when SMTP fails', async () => {
    const smtp = {
      isConfigured: () => true,
      sendMail: async () => {
        throw new Error('smtp down');
      },
    } as unknown as SmtpEmailService;
    const service = new EmailService(smtp);
    const result = await service.sendBestEffort(
      'user@example.com',
      EmailTemplateId.SECURITY_PASSWORD_RESET_COMPLETED,
      { fullName: 'Test' },
    );
    eq(result, { sent: false, reason: 'send_failed' });
  });

  await assert('sends rendered mail when configured', async () => {
    const calls: Array<{ to: string; subject: string; text: string; html?: string }> = [];
    const smtp = {
      isConfigured: () => true,
      sendMail: async (payload: { to: string; subject: string; text: string; html?: string }) => {
        calls.push(payload);
      },
    } as unknown as SmtpEmailService;
    const service = new EmailService(smtp);
    const result = await service.sendBestEffort(
      ' user@example.com ',
      EmailTemplateId.SECURITY_PASSWORD_RESET_REQUESTED,
      { fullName: 'Jean', resetUrl: 'https://ecd.example/reset-password?token=abc' },
    );
    eq(result, { sent: true });
    eq(calls.length, 1);
    eq(calls[0].to, 'user@example.com');
    if (!calls[0].subject.includes('Reset your ECD password')) {
      throw new Error(`unexpected subject: ${calls[0].subject}`);
    }
    if (!calls[0].text.includes('https://ecd.example/reset-password?token=abc')) {
      throw new Error('text missing reset url');
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
