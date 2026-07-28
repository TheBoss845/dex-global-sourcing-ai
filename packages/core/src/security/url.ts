import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError, ErrorCodes } from '../errors.js';

const PRIVATE_IPV4 =
  /^(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[0-1])\.|192\.168\.|0\.|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.|198\.18\.|198\.19\.)/;

export function isBlockedHostnameOrIp(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    if (host === '169.254.169.254') return true;
    return PRIVATE_IPV4.test(host);
  }
  if (ipVersion === 6) {
    return (
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host === '0:0:0:0:0:0:0:1'
    );
  }
  return false;
}

export type SafeUrlOptions = {
  /** When true (default), allow http and https. */
  allowHttp?: boolean;
};

/**
 * Syntactic + host safety checks (no DNS yet).
 */
export function assertSafeUrl(raw: string, options: SafeUrlOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(ErrorCodes.ValidationError, 'Invalid URL');
  }

  const allowHttp = options.allowHttp !== false;
  if (url.protocol === 'https:') {
    // ok
  } else if (allowHttp && url.protocol === 'http:') {
    // ok
  } else {
    throw new AppError(ErrorCodes.SsrfBlocked, 'Only HTTP and HTTPS URLs are allowed');
  }

  if (isBlockedHostnameOrIp(url.hostname)) {
    throw new AppError(ErrorCodes.SsrfBlocked, 'Private or local hosts are blocked');
  }

  return url;
}

/**
 * Resolve DNS and ensure every address is publicly routable (anti-SSRF / rebinding).
 */
export async function assertSafePublicUrl(raw: string, options: SafeUrlOptions = {}): Promise<URL> {
  const url = assertSafeUrl(raw, options);

  if (isIP(url.hostname)) {
    if (isBlockedHostnameOrIp(url.hostname)) {
      throw new AppError(ErrorCodes.SsrfBlocked, 'Blocked IP address');
    }
    return url;
  }

  let records: string[] = [];
  try {
    const result = await dns.lookup(url.hostname, { all: true, verbatim: true });
    records = result.map((row) => row.address);
  } catch {
    throw new AppError(ErrorCodes.ValidationError, `Unable to resolve host: ${url.hostname}`);
  }

  if (records.length === 0) {
    throw new AppError(ErrorCodes.ValidationError, `No DNS records for host: ${url.hostname}`);
  }

  for (const address of records) {
    if (isBlockedHostnameOrIp(address)) {
      throw new AppError(
        ErrorCodes.SsrfBlocked,
        `Host resolves to a blocked address (${address})`,
      );
    }
  }

  return url;
}

const MULTI_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.in',
  'com.au',
  'net.au',
  'co.nz',
  'co.jp',
  'com.br',
  'co.kr',
  'com.mx',
  'com.sg',
  'co.za',
  'com.hk',
  'com.tw',
]);

export function extractRegistrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}
