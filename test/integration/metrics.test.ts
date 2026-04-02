import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const uploadMock = vi.fn().mockResolvedValue({
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
});

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
    generate = vi.fn().mockResolvedValue(Buffer.alloc(12000, '%'));
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../src/services/storage/StorageService.js', () => ({
  StorageService: class {
    upload = uploadMock;
  },
}));

vi.mock('../../src/plugins/s3.js', () => ({
  s3Plugin: async (fastify: FastifyInstance) => {
    fastify.decorate('s3', {});
    fastify.decorate('s3Public', {});
  },
}));

describe('GET /metrics', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { buildApp } = await import('../../src/server.js');
    app = await buildApp();
    await app.ready();
    uploadMock.mockReset();
    uploadMock.mockResolvedValue({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with Prometheus text content type', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('returns histogram and counter metric names', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    const body = response.body;
    expect(body).toContain('pdf_generation_duration_ms');
    expect(body).toContain('pdf_size_bytes');
    expect(body).toContain('pdf_generation_requests_total');
  });

  it('reflects a successful PDF generation in the metrics', async () => {
    await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: { html: '<html><body>hello</body></html>' },
    });

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    const body = response.body;

    expect(body).toContain('pdf_generation_requests_total{status="success"} 1');
    expect(body).toContain('pdf_generation_requests_total{status="error"} 0');
    expect(body).toContain('pdf_generation_duration_ms_count 1');
    // 12000 bytes falls in the 51200 bucket and above
    expect(body).toContain('pdf_size_bytes_bucket{le="10240"} 0');
    expect(body).toContain('pdf_size_bytes_bucket{le="51200"} 1');
    expect(body).toContain('pdf_size_bytes_count 1');
  });

  it('counts upload failures as errors instead of successes', async () => {
    uploadMock.mockRejectedValueOnce(new Error('S3 upload failed'));

    const generateResponse = await app.inject({
      method: 'POST',
      url: '/pdf/generate',
      payload: { html: '<html><body>hello</body></html>' },
    });

    expect(generateResponse.statusCode).toBe(500);

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    const body = response.body;

    expect(body).toContain('pdf_generation_requests_total{status="success"} 0');
    expect(body).toContain('pdf_generation_requests_total{status="error"} 1');
    expect(body).toContain('pdf_generation_duration_ms_count 0');
    expect(body).toContain('pdf_size_bytes_count 0');
  });
});
