/**
 * AuthService password-reset email delivery tests.
 * Run: npx ts-node src/modules/auth/__tests__/auth-password-reset.spec.ts
 */
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserAccountStatus } from '../../../common/domain';
import { EmailTemplateId } from '../../email/email-template.ids';
import { EmailService } from '../../email/email.service';
import { AuthService } from '../auth.service';

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

type SendCall = {
  to: string | null | undefined;
  templateId: EmailTemplateId;
  payload: Record<string, string | number | undefined>;
};

function createService(opts: {
  user?: { id: string; email: string | null; fullName: string } | null;
  resetToken?: {
    id: string;
    userId: string;
    usedAt: Date | null;
    expiresAt: Date;
    user: { id: string; status: string; email: string | null; fullName: string };
  } | null;
  frontendUrl?: string;
}) {
  const sends: SendCall[] = [];
  const tokens: Array<{ userId: string; tokenHash: string }> = [];

  const prisma = {
    userAccount: {
      findFirst: async () => opts.user ?? null,
      update: async () => ({}),
    },
    passwordResetToken: {
      create: async (args: { data: { userId: string; tokenHash: string } }) => {
        tokens.push({ userId: args.data.userId, tokenHash: args.data.tokenHash });
        return { id: 'prt-1' };
      },
      findUnique: async () => opts.resetToken ?? null,
      update: async () => ({}),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  const config = {
    get: (key: string) => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'FRONTEND_URL') return opts.frontendUrl;
      return undefined;
    },
  } as ConfigService;

  const email = {
    sendBestEffort: async (
      to: string | null | undefined,
      templateId: EmailTemplateId,
      payload: Record<string, string | number | undefined>,
    ) => {
      sends.push({ to, templateId, payload });
      return { sent: true };
    },
  } as unknown as EmailService;

  const service = new AuthService(prisma as never, {} as JwtService, config, email);
  return { service, sends, tokens };
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

  await assert('request requires username or email', async () => {
    const { service } = createService({ user: null });
    try {
      await service.requestPasswordReset({});
      throw new Error('expected BadRequestException');
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
    }
  });

  await assert('unknown user is accepted without email', async () => {
    const { service, sends, tokens } = createService({ user: null });
    const result = await service.requestPasswordReset({ username: 'missing' });
    eq(result, { accepted: true });
    eq(sends.length, 0);
    eq(tokens.length, 0);
  });

  await assert('user without email creates token but does not send', async () => {
    const { service, sends, tokens } = createService({
      user: { id: 'u1', email: null, fullName: 'No Mail' },
    });
    const result = await service.requestPasswordReset({ username: 'nomail' });
    eq(result, { accepted: true });
    eq(tokens.length, 1);
    eq(tokens[0].userId, 'u1');
    eq(sends.length, 0);
  });

  await assert('user with email is sent a reset link', async () => {
    const { service, sends, tokens } = createService({
      user: { id: 'u1', email: 'user@example.com', fullName: 'Jane Doe' },
      frontendUrl: 'https://ecd.example',
    });
    const result = await service.requestPasswordReset({ email: 'user@example.com' });
    eq(result, { accepted: true });
    eq(tokens.length, 1);
    eq(sends.length, 1);
    eq(sends[0].to, 'user@example.com');
    eq(sends[0].templateId, EmailTemplateId.SECURITY_PASSWORD_RESET_REQUESTED);
    eq(sends[0].payload.fullName, 'Jane Doe');
    const resetUrl = String(sends[0].payload.resetUrl ?? '');
    if (!resetUrl.startsWith('https://ecd.example/reset-password?token=')) {
      throw new Error(`unexpected resetUrl: ${resetUrl}`);
    }
    const token = String(sends[0].payload.resetToken ?? '');
    if (token.length < 32) {
      throw new Error('reset token too short');
    }
  });

  await assert('confirm success emails the user', async () => {
    const { service, sends } = createService({
      resetToken: {
        id: 'prt-1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: 'u1',
          status: UserAccountStatus.active,
          email: 'user@example.com',
          fullName: 'Jane Doe',
        },
      },
    });
    const result = await service.confirmPasswordReset({
      token: 'any-token',
      newPassword: 'newSecret1',
    });
    eq(result, { success: true });
    eq(sends.length, 1);
    eq(sends[0].templateId, EmailTemplateId.SECURITY_PASSWORD_RESET_COMPLETED);
    eq(sends[0].to, 'user@example.com');
  });

  await assert('invalid confirm token does not send email', async () => {
    const { service, sends } = createService({ resetToken: null });
    try {
      await service.confirmPasswordReset({ token: 'bad', newPassword: 'newSecret1' });
      throw new Error('expected BadRequestException');
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
    }
    eq(sends.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
