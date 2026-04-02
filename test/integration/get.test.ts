import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const MISSING_UUID = '0f7f4b24-fb7d-4f7b-a94d-a673d2f6ef83';

vi.mock('../../src/config/env.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    SIGNED_URL_EXPIRY_SECONDS: 3600,
    LOG_LEVEL: 'error',
    PORT: 8080,
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
      id: VALID_UUID,
      url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
    });
    getUrl = vi.fn().mockImplementation(async (id: string) => {
      if (id === MISSING_UUID) {
        throw Object.assign(new Error(`PDF not found: ${id}`), { statusCode: 404 });
      }

      return 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true';
    });
    delete = vi.fn().mockResolvedValue(undefined);
    download = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test'));
  },
}));

vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

describe('GET /pdf/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a presigned URL for a valid UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/pdf/${VALID_UUID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      statusCode: 200,
      data: { url: expect.stringContaining('https://') },
    });
  });

  it('returns 400 for an invalid (non-UUID) id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/pdf/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when the PDF does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/pdf/${MISSING_UUID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toContain('PDF not found');
  });
});
