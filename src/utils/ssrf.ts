import { isIP } from 'net';
import { lookup } from 'dns/promises';
import ipaddr from 'ipaddr.js';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

// URL spec wraps IPv6 literals in brackets ("[::1]"); strip them before isIP/lookup.
function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * True for any address that is NOT a normal public unicast address — i.e.
 * private, loopback, link-local (169.254/fe80 cloud-metadata), unique-local
 * (fc00::/7 incl. fd00::/8), unspecified (0.0.0.0/::), carrier-grade NAT,
 * reserved, multicast or broadcast.
 *
 * IPv4-mapped IPv6 (::ffff:127.0.0.1) is demapped first so a blocked IPv4
 * address cannot be smuggled past the check inside an IPv6 literal.
 * Unparseable input fails closed.
 */
export function isBlockedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true;
  }

  if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) {
    return addr.toIPv4Address().range() !== 'unicast';
  }

  return addr.range() !== 'unicast';
}

async function resolveIp(hostname: string): Promise<string> {
  if (isIP(hostname)) return hostname;
  const { address } = await lookup(hostname, { verbatim: true });
  return address;
}

/** Throws SsrfError if the top-level URL is unsafe to navigate to. */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new SsrfError(`Scheme "${parsed.protocol}" is not allowed`);
  }

  const ip = await resolveIp(stripBrackets(parsed.hostname));

  if (isBlockedIp(ip)) {
    throw new SsrfError(`URL resolves to a blocked address (${ip})`);
  }
}

/**
 * Non-throwing guard for Chromium request interception. Returns false for any
 * http(s) request whose host resolves to a non-public address, and for
 * unparseable URLs. Non-http(s) schemes (data:, blob:, about:) are handled by
 * the caller, not here.
 */
export async function isRequestUrlAllowed(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false;

  try {
    const ip = await resolveIp(stripBrackets(parsed.hostname));
    return !isBlockedIp(ip);
  } catch {
    return false;
  }
}
