import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
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

vi.mock('../../src/services/pdf/PdfService.js', () => ({
  PdfService: class {
    getBrowser = vi.fn().mockResolvedValue({});
    generate = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test'));
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

// Provide a real minimal PDF buffer so pdf-lib can load it during the merge
let minimalPdfBuffer: Buffer;

vi.mock('../../src/services/storage/StorageService.js', () => ({
  StorageService: class {
    upload = vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/pdfs/merged.pdf?signed=true');
    getUrl = vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true');
    delete = vi.fn().mockResolvedValue(undefined);
    download = vi.fn().mockImplementation(() => Promise.resolve(minimalPdfBuffer));
  },
}));

vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

const UUID1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const UUID2 = 'b1ffcd00-0d1c-4f09-8c7e-7cc0ce491b22';

describe('POST /pdf/merge', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    minimalPdfBuffer = Buffer.from(await doc.save());

    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a presigned URL when stream is false', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/merge',
      payload: { ids: [UUID1, UUID2] },
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
      url: '/pdf/merge',
      payload: { ids: [UUID1, UUID2], stream: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
  });

  it('returns 400 when fewer than 2 IDs are provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/merge',
      payload: { ids: [UUID1] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for non-UUID ids', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/merge',
      payload: { ids: ['not-a-uuid', 'also-not-a-uuid'] },
    });

    expect(response.statusCode).toBe(400);
  });
});
