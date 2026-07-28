export function appBaseUrl(request?: Request): string {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
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

export async function sendVerificationEmail(input: {
  to: string;
  verifyUrl: string;
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
      subject: 'Sign in to the DEX Global Sourcing Assistant',
      html: `
        <p>Use this link to sign in to the Data Exchange Corporation (DEX) Global Sourcing Assistant:</p>
        <p><a href="${input.verifyUrl}">Verify my email and sign in</a></p>
        <p>This link expires in 15 minutes. If you did not request it, ignore this email.</p>
      `,
      text: `Sign in to the DEX Global Sourcing Assistant:\n${input.verifyUrl}\n\nThis link expires in 15 minutes.`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(friendlyResendError(response.status, detail));
  }
}
