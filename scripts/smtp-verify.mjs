import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const env = loadEnv(resolve(process.cwd(), '.env'));
const host = env.SMTP_HOST;
const port = Number(env.SMTP_PORT ?? '587');
const secure = env.SMTP_SECURE === 'true';
const user = env.SMTP_USER;
const pass = env.SMTP_PASS;
const from = env.SMTP_FROM;

console.log('SMTP config (redacted):');
console.log(`  host=${host ?? '(missing)'}`);
console.log(`  port=${port}`);
console.log(`  secure=${secure}`);
console.log(`  user=${user ?? '(missing)'}`);
console.log(`  pass=${pass ? '[set]' : '[missing]'}`);
console.log(`  from=${from ?? '(missing)'}`);

if (!host || !from) {
  console.error('\nFAIL: SMTP_HOST and SMTP_FROM are required');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: user && pass ? { user, pass } : undefined,
});

try {
  await transporter.verify();
  console.log('\nOK: SMTP verify() succeeded (auth + connection)');
  process.exit(0);
} catch (err) {
  console.error('\nFAIL: SMTP verify() failed');
  console.error(err instanceof Error ? err.message : String(err));
  if (err && typeof err === 'object' && 'response' in err) {
    console.error('response:', err.response);
  }
  process.exit(1);
}
