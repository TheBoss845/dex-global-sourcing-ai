function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a[i]! ^ b[i]!;
  return out === 0;
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(matches.map((byte) => Number.parseInt(byte, 16)));
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return toHex(sig);
}

/** Signs cookies. Prefer AUTH_SECRET; fall back to DEX_API_KEY for older deploys. */
export function sessionSecret(): string | null {
  return process.env.AUTH_SECRET?.trim() || process.env.DEX_API_KEY?.trim() || null;
}

export function allowedEmails(): string[] {
  return (process.env.DEX_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return false;
  const allow = allowedEmails();
  if (allow.length === 0) return false;
  if (allow.includes(normalized)) return true;
  // Support domain allowlist entries like "@dex.com"
  return allow.some((entry) => entry.startsWith('@') && normalized.endsWith(entry));
}

export function authRequired(): boolean {
  return process.env.NODE_ENV === 'production' || allowedEmails().length > 0;
}

export function authConfigured(): boolean {
  return Boolean(sessionSecret()) && allowedEmails().length > 0;
}

export async function createSessionToken(secret: string, email: string): Promise<string> {
  const payload = `email:${normalizeEmail(email)}:${Date.now()}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<{ ok: boolean; email?: string }> {
  if (!token) return { ok: false };
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return { ok: false };
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (!payload || !sig) return { ok: false };
  const expected = await hmacHex(secret, payload);
  try {
    if (!timingSafeEqualBytes(fromHex(sig), fromHex(expected))) return { ok: false };
  } catch {
    return { ok: false };
  }
  const parts = payload.split(':');
  if (parts[0] !== 'email' || !parts[1]) return { ok: false };
  const email = parts[1];
  if (!isAllowedEmail(email)) return { ok: false };
  return { ok: true, email };
}

/** Optional machine access header; not used for the human login UI. */
export function apiKeyMatches(headerKey: string | null): boolean {
  const secret = process.env.DEX_API_KEY?.trim();
  if (!secret || !headerKey) return false;
  const enc = new TextEncoder();
  return timingSafeEqualBytes(enc.encode(headerKey), enc.encode(secret));
}
