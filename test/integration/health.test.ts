import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock env before importing server
vi.mock('../../src/config/env.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    SIGNED_URL_EXPIRY_SECONDS: 3600,
    LOG_LEVEL: 'error',
    PORT: 8080,
  },
}));

// Mock PdfService - no real browser needed
vi.mock('../../src/services/pdf/PdfService.js', () => ({
  PdfService: class {
    getBrowser = vi.fn().mockResolvedValue({});
    generate = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test'));
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock StorageService
vi.mock('../../src/services/storage/StorageService.js', () => ({
  StorageService: class {
    upload = vi
      .fn()
      .mockResolvedValue({
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
      });
  },
}));

// Mock s3Plugin
vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('responds to HEAD /health', async () => {
    const response = await app.inject({
      method: 'HEAD',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
  });
});
