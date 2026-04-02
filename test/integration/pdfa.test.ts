import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const STORED_PDF = {
  id: '4aa737ee-e6e7-4f17-b455-cc0ec0d54bb1',
  url: 'https://s3.amazonaws.com/test-bucket/pdfs/pdfa.pdf?signed=true',
};
const SOURCE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const MISSING_ID = '0f7f4b24-fb7d-4f7b-a94d-a673d2f6ef83';

vi.mock('../../src/config/env.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    SIGNED_URL_EXPIRY_SECONDS: 3600,
    LOG_LEVEL: 'error',
    PORT: 8080,
    GHOSTSCRIPT_PATH: '/usr/bin/gs',
  },
}));

vi.mock('../../src/services/pdf/PdfService.js', () => ({
  PdfService: class {
    getBrowser = vi.fn().mockResolvedValue({});
    generate = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test'));
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../src/services/pdf/PdfOperationsService.js', () => ({
  PdfOperationsService: class {
    constructor(_ghostscriptPath?: string) {}

    get canUseGhostscript() {
      return true;
    }

    split = vi.fn();
    compress = vi.fn();
    convertToPdfA = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 pdfa'));
  },
}));

vi.mock('../../src/services/storage/StorageService.js', () => ({
  StorageService: class {
    upload = vi.fn().mockResolvedValue(STORED_PDF);
    getUrl = vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true');
    delete = vi.fn().mockResolvedValue(undefined);
    download = vi.fn().mockImplementation(async (id: string) => {
      if (id === MISSING_ID) {
        throw Object.assign(new Error(`PDF not found: ${id}`), { statusCode: 404 });
      }

      return Buffer.from('%PDF-1.4 source');
    });
  },
}));

vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

describe('POST /pdf/pdfa', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a stored PDF response when stream is false', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/pdfa',
      payload: { id: SOURCE_ID, conformance: '2b' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      statusCode: 200,
      data: STORED_PDF,
    });
  });

  it('returns binary PDF when stream is true', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/pdfa',
      payload: { id: SOURCE_ID, conformance: '2b', stream: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
  });

  it('returns 400 for an invalid conformance level', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/pdfa',
      payload: { id: SOURCE_ID, conformance: '9z' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when the source PDF does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pdf/pdfa',
      payload: { id: MISSING_ID, conformance: '2b' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toContain('PDF not found');
  });
});
