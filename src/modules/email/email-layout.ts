/** Escapes user-controlled strings for safe HTML email bodies. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type EmailCallout = {
  label: string;
  value: string;
};

export type TransactionalEmailBody = {
  greetingName: string;
  paragraphs: string[];
  callouts?: EmailCallout[];
  action?: { label: string; url: string };
  footerNote?: string;
};

const BRAND = {
  navy: '#0f172a',
  accent: '#2563eb',
  text: '#334155',
  muted: '#64748b',
  border: '#e2e8f0',
  surface: '#f8fafc',
};

const PRODUCT_NAME = 'ECD Platform';
const PRODUCT_TAGLINE = 'Early Childhood Development';

export function renderTransactionalEmailText(body: TransactionalEmailBody): string {
  const lines: string[] = [`Hello ${body.greetingName},`, ''];

  for (const paragraph of body.paragraphs) {
    lines.push(paragraph, '');
  }

  if (body.callouts?.length) {
    for (const callout of body.callouts) {
      lines.push(`${callout.label}: ${callout.value}`, '');
    }
  }

  if (body.action) {
    lines.push(`${body.action.label}: ${body.action.url}`, '');
  }

  if (body.footerNote) {
    lines.push(body.footerNote);
  }

  lines.push('', `— ${PRODUCT_NAME}`);
  return lines.join('\n').replace(/\n\n\n+/g, '\n\n').trim();
}

export function renderTransactionalEmailHtml(
  subject: string,
  body: TransactionalEmailBody,
): string {
  const greeting = escapeHtml(body.greetingName);
  const preheader = escapeHtml(body.paragraphs[0] ?? subject);
  const year = new Date().getFullYear();

  const paragraphHtml = body.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.text};">${escapeHtml(p)}</p>`,
    )
    .join('');

  const calloutHtml =
    body.callouts
      ?.map(
        (c) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid ${BRAND.border};border-radius:8px;background:${BRAND.surface};">
        <tr>
          <td style="padding:14px 16px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">${escapeHtml(c.label)}</p>
            <p style="margin:0;font-size:15px;line-height:1.5;color:${BRAND.navy};word-break:break-all;font-family:Consolas,'Courier New',monospace;">${escapeHtml(c.value)}</p>
          </td>
        </tr>
      </table>`,
      )
      .join('') ?? '';

  const actionHtml = body.action
    ? `<p style="margin:8px 0 20px;">
        <a href="${escapeHtml(body.action.url)}" style="display:inline-block;padding:12px 20px;background:${BRAND.accent};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(body.action.label)}</a>
      </p>`
    : '';

  const footerHtml = body.footerNote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${BRAND.muted};">${escapeHtml(body.footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BRAND.border};">
          <tr>
            <td style="background:${BRAND.navy};padding:24px 28px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">${PRODUCT_NAME}</p>
              <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">${PRODUCT_TAGLINE}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:${BRAND.navy};">Hello ${greeting},</p>
              ${paragraphHtml}
              ${actionHtml}
              ${calloutHtml}
              ${footerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;border-top:1px solid ${BRAND.border};background:${BRAND.surface};">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};">
                This is an automated message from ${PRODUCT_NAME}. Please do not reply to this email.
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:${BRAND.muted};">&copy; ${year} ${PRODUCT_NAME}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildRenderedEmail(
  subject: string,
  body: TransactionalEmailBody,
): { subject: string; text: string; html: string } {
  return {
    subject,
    text: renderTransactionalEmailText(body),
    html: renderTransactionalEmailHtml(subject, body),
  };
}
