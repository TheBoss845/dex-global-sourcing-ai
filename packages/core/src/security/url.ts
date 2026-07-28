import { isIP } from 'node:net';
import { AppError, ErrorCodes } from '../errors.js';

const PRIVATE_IPV4 =
  /^(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[0-1])\.|192\.168\.|0\.|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.)/;

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return PRIVATE_IPV4.test(host);
  if (ipVersion === 6) {
    return (
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80')
    );
  }
  return false;
}

export type SafeUrlOptions = {
  allowedHosts?: string[];
  requireHttps?: boolean;
};

/**
 * Validate user-supplied URLs before any fetch/Playwright navigation (SSRF guard).
 */
export function assertSafeUrl(raw: string, options: SafeUrlOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(ErrorCodes.ValidationError, 'Invalid URL');
  }

  if (options.requireHttps !== false && url.protocol !== 'https:') {
    throw new AppError(ErrorCodes.SsrfBlocked, 'Only HTTPS URLs are allowed');
  }

  if (isPrivateOrLocalHost(url.hostname)) {
    throw new AppError(ErrorCodes.SsrfBlocked, 'Private or local hosts are blocked');
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    const host = url.hostname.toLowerCase();
    const allowed = options.allowedHosts.some(
      (entry) => host === entry || host.endsWith(`.${entry}`),
    );
    if (!allowed) {
      throw new AppError(ErrorCodes.SsrfBlocked, `Host not allowlisted: ${host}`);
    }
  }

  return url;
}

export function extractRegistrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}
