import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const STORED_PDF = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
};

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
    upload = vi.fn().mockResolvedValue(STORED_PDF);
  },
}));

// Mock s3Plugin
vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
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
      data: STORED_PDF,
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

  it('accepts headerTemplate and footerTemplate', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body><h1>Test</h1></body></html>',
        options: {
          headerTemplate: '<div style="font-size:10px;text-align:center;">Header</div>',
          footerTemplate: '<div style="font-size:10px;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        },
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts a css field and returns 200', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body><h1>Test</h1></body></html>',
        css: 'body { font-size: 14px; color: #333; }',
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts headerTemplate without footerTemplate', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: {
        html: '<html><body></body></html>',
        options: {
          headerTemplate: '<div style="font-size:8px;">My Header</div>',
        },
      },
    });

    expect(response.statusCode).toBe(200);
  });
});
