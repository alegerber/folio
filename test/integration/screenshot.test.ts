import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/config/env.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    SIGNED_URL_EXPIRY_SECONDS: 3600,
    LOG_LEVEL: 'error',
    PORT: 8080,
  },
}));

// The mock page is created inside the factory: vi.mock is hoisted above any
// top-level const, so referencing an outer variable here would be undefined.
vi.mock('../../src/services/pdf/PdfService.js', () => ({
  PAGE_TIMEOUT_MS: 25_000,
  PdfService: class {
    getBrowser = vi.fn().mockResolvedValue({});
    newPage = vi.fn().mockResolvedValue({
      setViewport: vi.fn().mockResolvedValue(undefined),
      setContent: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      addStyleTag: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('PNG_DATA')),
      close: vi.fn().mockResolvedValue(undefined),
    });
    generate = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4'));
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../src/services/storage/StorageService.js', () => ({
  StorageService: class {
    upload = vi.fn();
    uploadImage = vi.fn().mockResolvedValue({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      url: 'https://s3.amazonaws.com/test-bucket/screenshots/test.png?signed=true',
    });
  },
}));

vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

describe('POST /screenshot', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a presigned URL for an HTML screenshot', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/screenshot',
      payload: { html: '<html><body><h1>Hi</h1></body></html>' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.url).toContain('screenshots/test.png');
  });

  it('streams the binary image when stream is true', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/screenshot',
      payload: { html: '<html><body></body></html>', stream: true, format: 'png' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
  });

  it('returns 400 when neither html nor url is provided', async () => {
    const response = await app.inject({ method: 'POST', url: '/screenshot', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when both html and url are provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/screenshot',
      payload: { html: '<html></html>', url: 'https://example.com' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for an unsupported format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/screenshot',
      payload: { html: '<html></html>', format: 'gif' },
    });
    expect(response.statusCode).toBe(400);
  });
});
