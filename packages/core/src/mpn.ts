/**
 * Normalize manufacturer part numbers for deterministic matching.
 */
export function normalizeMpn(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s._/-]+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function mpnsMatch(a: string, b: string): boolean {
  const left = normalizeMpn(a);
  const right = normalizeMpn(b);
  if (!left || !right) return false;
  return left === right;
}
