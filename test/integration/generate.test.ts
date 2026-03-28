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
  PdfService: vi.fn().mockImplementation(() => ({
    getBrowser: vi.fn().mockResolvedValue({}),
    generate: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock StorageService
vi.mock('../../src/services/storage/StorageService.js', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    upload: vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true'),
  })),
}));

// Mock s3Plugin
vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
  },
}));

describe('POST /pdf/generate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a presigned S3 URL when stream is false', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body><h1>Test</h1></body></html>',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      statusCode: 200,
      data: { url: expect.stringContaining('https://') },
    });
  });

  it('returns binary PDF when stream is true', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body><h1>Test</h1></body></html>',
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
  });

  it('returns 400 for missing html', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('accepts paper size and orientation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body></body></html>',
        paper: { size: 'A4', orientation: 'landscape' },
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts PDF options', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body></body></html>',
        options: {
          printBackground: true,
          scale: 0.9,
          margin: { top: '10mm', bottom: '10mm', left: '15mm', right: '15mm' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects scale outside 0.1-2.0 range', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body></body></html>',
        options: { scale: 5.0 },
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
