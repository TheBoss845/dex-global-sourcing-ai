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

export function sessionSecret(): string | null {
  return process.env.DEX_API_KEY?.trim() || null;
}

export function authRequired(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean(sessionSecret());
}

export async function createSessionToken(secret: string): Promise<string> {
  const payload = `dex:${Date.now()}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = await hmacHex(secret, payload);
  try {
    return timingSafeEqualBytes(fromHex(sig), fromHex(expected));
  } catch {
    return false;
  }
}

export function apiKeyMatches(headerKey: string | null, secret: string): boolean {
  if (!headerKey) return false;
  const enc = new TextEncoder();
  const a = enc.encode(headerKey);
  const b = enc.encode(secret);
  return timingSafeEqualBytes(a, b);
}
