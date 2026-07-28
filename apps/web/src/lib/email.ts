export function appBaseUrl(request?: Request): string {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  // Netlify sets URL; Render sets RENDER_EXTERNAL_URL.
  const netlifyUrl = process.env.URL?.trim().replace(/\/$/, '');
  if (netlifyUrl?.startsWith('http')) return netlifyUrl;
  const renderExternal = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, '');
  if (renderExternal) return renderExternal;
  if (request) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    if (host) return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

/** Accept RESEND_API_KEY (correct) or RESEND_API (common misname on Render). */
export function resendApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || process.env.RESEND_API?.trim() || null;
}

export function emailFrom(): string | null {
  return process.env.EMAIL_FROM?.trim() || null;
}

export function emailSendingConfigured(): boolean {
  return Boolean(resendApiKey() && emailFrom());
}

function friendlyResendError(status: number, body: string): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as { message?: string; name?: string; error?: string };
    message = parsed.message || parsed.error || '';
  } catch {
    message = body.slice(0, 300);
  }

  const lower = message.toLowerCase();
  if (status === 401 || lower.includes('api key')) {
    return 'Resend rejected the API key. Check RESEND_API_KEY on Render (name must be RESEND_API_KEY).';
  }
  if (lower.includes('only send testing emails') || lower.includes('resend.dev')) {
    return (
      'Resend test domain can only email the address on your Resend account. ' +
      'Either sign in with that same email, or verify a domain at resend.com/domains and set EMAIL_FROM to an address on that domain ' +
      '(e.g. DEX Sourcing <noreply@yourdomain.com>).'
    );
  }
  if (lower.includes('not verified') || lower.includes('domain')) {
    return (
      'EMAIL_FROM domain is not verified in Resend. ' +
      'For testing use: DEX <onboarding@resend.dev> and sign in with your Resend account email. ' +
      'For production verify a domain at resend.com/domains.'
    );
  }
  if (lower.includes('invalid') && lower.includes('from')) {
    return (
      'EMAIL_FROM is invalid. Use: DEX Sourcing <onboarding@resend.dev> ' +
      'or DEX Sourcing <noreply@your-verified-domain.com>'
    );
  }
  return message
    ? `Could not send email via Resend: ${message}`
    : `Could not send email via Resend (HTTP ${status}).`;
}

function verificationEmailHtml(input: { verifyUrl: string; code: string }): string {
  const digits = input.code
    .split('')
    .map(
      (d) =>
        `<td style="width:44px;height:56px;text-align:center;font-size:26px;font-weight:700;color:#0a1f33;background:#f2f5f9;border:1px solid #d7dfe9;border-radius:10px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">${d}</td><td style="width:8px;"></td>`,
    )
    .join('');
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <tr>
            <td style="background:linear-gradient(135deg,#1d5bd8,#0a1f33);border-radius:16px 16px 0 0;padding:28px 32px;">
              <p style="margin:0;color:#9db9e8;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:600;">Data Exchange Corporation</p>
              <p style="margin:6px 0 0;color:#ffffff;font-size:20px;font-weight:700;">DEX Global Sourcing Assistant</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:0 0 16px 16px;padding:32px;">
              <p style="margin:0;color:#14212e;font-size:16px;font-weight:600;">Confirm your sign-in</p>
              <p style="margin:10px 0 0;color:#5d6d7e;font-size:14px;line-height:1.6;">
                Enter this verification code in the app:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto;"><tr>${digits}</tr></table>
              <p style="margin:0;color:#5d6d7e;font-size:14px;line-height:1.6;text-align:center;">or</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 0 4px;">
                <a href="${input.verifyUrl}" style="display:inline-block;background:#1d5bd8;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 32px;border-radius:10px;">Sign in with one click</a>
              </td></tr></table>
              <p style="margin:20px 0 0;color:#8b9aab;font-size:12px;line-height:1.6;">
                This code and link expire in 15 minutes and can be used once.
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px;text-align:center;">
              <p style="margin:0;color:#8b9aab;font-size:11px;">© ${new Date().getFullYear()} Data Exchange Corporation (DEX) · Global Sourcing Assistant</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendVerificationEmail(input: {
  to: string;
  verifyUrl: string;
  code: string;
}): Promise<void> {
  const apiKey = resendApiKey();
  const from = emailFrom();
  if (!apiKey || !from) {
    throw new Error(
      'Email sending is not configured. On Render set RESEND_API_KEY and EMAIL_FROM ' +
        '(example EMAIL_FROM: DEX <onboarding@resend.dev>).',
    );
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `${input.code} is your DEX sign-in code`,
      html: verificationEmailHtml(input),
      text: `Your DEX Global Sourcing sign-in code: ${input.code}\n\nOr sign in with this link:\n${input.verifyUrl}\n\nThis code expires in 15 minutes.`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(friendlyResendError(response.status, detail));
  }
}
