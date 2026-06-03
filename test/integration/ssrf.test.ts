import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// SSRF protection explicitly enabled so the guard path is actually exercised
// end-to-end (the other integration suites leave it unset).
vi.mock('../../src/config/env.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    SIGNED_URL_EXPIRY_SECONDS: 3600,
    LOG_LEVEL: 'error',
    PORT: 8080,
    SSRF_PROTECTION: true,
  },
}));

// Page object inlined in the factory — vi.mock is hoisted above top-level consts.
vi.mock('../../src/services/pdf/PdfService.js', () => ({
  PAGE_TIMEOUT_MS: 25_000,
  PdfService: class {
    getBrowser = vi.fn().mockResolvedValue({});
    newPage = vi.fn().mockResolvedValue({
      setViewport: vi.fn().mockResolvedValue(undefined),
      setContent: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      addStyleTag: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('PNG')),
      close: vi.fn().mockResolvedValue(undefined),
    });
    generate = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test'));
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../src/services/storage/StorageService.js', () => ({
  StorageService: class {
    upload = vi.fn().mockResolvedValue({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
    });
    uploadImage = vi.fn().mockResolvedValue({ id: 'x', url: 'https://s3/shot.png' });
  },
}));

vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

describe('SSRF guard at the route layer (SSRF_PROTECTION on)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Literal IPs need no DNS, so these assert deterministically without network.
  it('rejects POST /pdf/generate to loopback', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: { url: 'http://127.0.0.1/' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects POST /pdf/generate to the cloud metadata endpoint', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects POST /screenshot to a private address', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/screenshot',
      payload: { url: 'http://10.0.0.1/' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('allows a public IP literal through the guard', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: { url: 'http://93.184.216.34/' },
    });
    expect(response.statusCode).toBe(200);
  });
});
