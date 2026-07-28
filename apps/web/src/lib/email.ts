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

export function emailSendingConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendVerificationEmail(input: {
  to: string;
  verifyUrl: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error('Email sending is not configured (RESEND_API_KEY / EMAIL_FROM)');
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
      subject: 'Sign in to DEX Global Sourcing Assistant',
      html: `
        <p>Use this link to sign in to the DEX Global Sourcing Assistant:</p>
        <p><a href="${input.verifyUrl}">Verify my @dex.com email</a></p>
        <p>This link expires in 15 minutes. If you did not request it, ignore this email.</p>
      `,
      text: `Sign in to DEX Global Sourcing Assistant:\n${input.verifyUrl}\n\nThis link expires in 15 minutes.`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to send verification email (HTTP ${response.status}) ${detail}`.trim());
  }
}
