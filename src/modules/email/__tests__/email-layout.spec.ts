/**
 * Email layout / template tests.
 * Run: npx ts-node src/modules/email/__tests__/email-layout.spec.ts
 */
import { escapeHtml, renderTransactionalEmailHtml, renderTransactionalEmailText } from '../email-layout';
import { EmailTemplateId } from '../email-template.ids';
import { renderEmailTemplate } from '../email-template.registry';

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

function includes(haystack: string, needle: string, label?: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label ?? 'includes'} expected to contain ${JSON.stringify(needle)}`);
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

  await assert('escapeHtml encodes markup', () => {
    eq(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  await assert('text and html include greeting and callout', () => {
    const body = {
      greetingName: 'Jean',
      paragraphs: ['Your password was reset.'],
      callouts: [{ label: 'Reason', value: 'Test & demo' }],
      action: { label: 'Reset password', url: 'https://app.example/reset?token=abc' },
    };
    const text = renderTransactionalEmailText(body);
    const html = renderTransactionalEmailHtml('Password reset', body);
    includes(text, 'Hello Jean');
    includes(text, 'Reason: Test & demo');
    includes(text, 'https://app.example/reset?token=abc');
    includes(html, 'ECD Platform');
    includes(html, 'Hello Jean');
    includes(html, 'Test &amp; demo');
    includes(html, 'https://app.example/reset?token=abc');
    eq(html.includes('<script>'), false);
  });

  await assert('password reset requested includes link and token fallback', () => {
    const withUrl = renderEmailTemplate(EmailTemplateId.SECURITY_PASSWORD_RESET_REQUESTED, {
      fullName: 'Jean',
      resetUrl: 'https://ecd.example/reset-password?token=abc123',
    });
    includes(withUrl.subject, 'Reset your ECD password');
    includes(withUrl.text, 'Jean');
    includes(withUrl.text, 'https://ecd.example/reset-password?token=abc123');
    includes(withUrl.html, '<!DOCTYPE html>');
    includes(withUrl.html, 'Reset password');

    const withToken = renderEmailTemplate(EmailTemplateId.SECURITY_PASSWORD_RESET_REQUESTED, {
      fullName: 'Jean',
      resetToken: 'raw-token',
    });
    includes(withToken.text, 'raw-token');
  });

  await assert('password reset completed copy', () => {
    const email = renderEmailTemplate(EmailTemplateId.SECURITY_PASSWORD_RESET_COMPLETED, {
      fullName: 'Jean',
    });
    includes(email.subject, 'password was reset');
    includes(email.text, 'successfully reset');
  });

  await assert('account provisioned includes credentials', () => {
    const email = renderEmailTemplate(EmailTemplateId.SECURITY_ACCOUNT_PROVISIONED, {
      fullName: 'Jean',
      username: 'jean.doe',
      temporaryPassword: 'TempPass12',
      loginUrl: 'https://ecd.example',
    });
    includes(email.subject, 'account credentials');
    includes(email.text, 'jean.doe');
    includes(email.text, 'TempPass12');
    includes(email.html, 'Sign in');
    includes(email.html, 'https://ecd.example');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
