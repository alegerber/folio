import { isIP } from 'net';
import { lookup } from 'dns/promises';

const BLOCKED_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

export async function assertSafeUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SsrfError(`Scheme "${parsed.protocol}" is not allowed`);
  }

  // URL spec wraps IPv6 literals in brackets: "[::1]" — strip them before isIP/lookup
  const rawHostname = parsed.hostname;
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;
  let ip: string;

  if (isIP(hostname)) {
    ip = hostname;
  } else {
    const result = await lookup(hostname, { verbatim: true });
    ip = result.address;
  }

  for (const range of BLOCKED_RANGES) {
    if (range.test(ip)) {
      throw new SsrfError(`URL resolves to a private address (${ip})`);
    }
  }
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}
