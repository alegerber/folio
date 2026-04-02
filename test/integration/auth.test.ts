import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const TEST_API_KEY = 'integration-test-key-minimum-32-characters-long';

vi.mock('../../src/config/env.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    SIGNED_URL_EXPIRY_SECONDS: 3600,
    LOG_LEVEL: 'error',
    PORT: 8080,
    API_KEY: TEST_API_KEY,
  },
}));

vi.mock('../../src/services/pdf/PdfService.js', () => ({
  PdfService: class {
    getBrowser = vi.fn().mockResolvedValue({});
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
  },
}));

vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

describe('API key authentication (integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 for requests without x-api-key header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ statusCode: 401, error: 'Unauthorized' });
  });

  it('returns 401 for requests with wrong x-api-key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-api-key': 'wrong-key-that-is-at-least-32-characters!' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('allows requests with correct x-api-key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-api-key': TEST_API_KEY },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 401 on POST /pdf/generate without key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: { html: '<html><body>Test</body></html>' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('allows POST /pdf/generate with correct key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: { html: '<html><body>Test</body></html>' },
    });
    expect(response.statusCode).toBe(200);
  });
});
