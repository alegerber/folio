import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertSafeUrl, SsrfError } from './ssrf.js';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'dns/promises';
const mockLookup = vi.mocked(lookup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertSafeUrl — scheme checks', () => {
  it('allows http scheme', async () => {
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(assertSafeUrl('http://example.com')).resolves.toBeUndefined();
  });

  it('allows https scheme', async () => {
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(assertSafeUrl('https://example.com')).resolves.toBeUndefined();
  });

  it('blocks file:// scheme', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(SsrfError);
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow('"file:" is not allowed');
  });

  it('blocks ftp:// scheme', async () => {
    await expect(assertSafeUrl('ftp://example.com/file')).rejects.toThrow(SsrfError);
  });

  it('blocks data:// scheme', async () => {
    await expect(assertSafeUrl('data:text/html,<h1>hi</h1>')).rejects.toThrow(SsrfError);
  });
});

describe('assertSafeUrl — private IP ranges blocked', () => {
  const privateIps = [
    ['10.0.0.1', 'RFC1918 class A'],
    ['10.255.255.255', 'RFC1918 class A edge'],
    ['172.16.0.1', 'RFC1918 class B low'],
    ['172.31.255.255', 'RFC1918 class B high'],
    ['192.168.0.1', 'RFC1918 class C'],
    ['127.0.0.1', 'loopback'],
    ['127.0.0.2', 'loopback range'],
    ['169.254.169.254', 'link-local / EC2 metadata'],
    ['169.254.0.1', 'link-local range'],
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'IPv6 ULA'],
    ['fe80::1', 'IPv6 link-local'],
  ] as const;

  for (const [ip, label] of privateIps) {
    it(`blocks ${label} (${ip}) when given directly`, async () => {
      await expect(assertSafeUrl(`http://${ip.includes(':') ? `[${ip}]` : ip}/path`)).rejects.toThrow(SsrfError);
    });
  }

  it('blocks private IP resolved from hostname', async () => {
    mockLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
    await expect(assertSafeUrl('http://internal.example.com')).rejects.toThrow(SsrfError);
  });

  it('includes the resolved IP in the error message', async () => {
    mockLookup.mockResolvedValue({ address: '192.168.1.100', family: 4 });
    await expect(assertSafeUrl('http://evil.example.com')).rejects.toThrow('192.168.1.100');
  });
});

describe('assertSafeUrl — public IPs allowed', () => {
  const publicIps = ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.15.255.255', '172.32.0.0'];

  for (const ip of publicIps) {
    it(`allows public IP ${ip}`, async () => {
      await expect(assertSafeUrl(`http://${ip}/`)).resolves.toBeUndefined();
    });
  }

  it('allows public hostname resolving to public IP', async () => {
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(assertSafeUrl('https://example.com')).resolves.toBeUndefined();
  });
});

describe('assertSafeUrl — hostname resolution', () => {
  it('calls lookup for non-IP hostnames', async () => {
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await assertSafeUrl('https://example.com/path?q=1');
    expect(mockLookup).toHaveBeenCalledWith('example.com', { verbatim: true });
  });

  it('does not call lookup for IP hostnames', async () => {
    await assertSafeUrl('https://93.184.216.34/');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('propagates DNS lookup errors', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeUrl('https://does-not-exist.invalid')).rejects.toThrow('ENOTFOUND');
  });
});
