import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

// The handler reads env.SSRF_PROTECTION and delegates URL safety to
// assertSafeUrl; both are mocked so we can drive every branch deterministically
// without DNS, a browser, or S3.
vi.mock('../../src/config/env.js', () => ({ env: { SSRF_PROTECTION: true } }));
vi.mock('../../src/utils/ssrf.js', () => {
  class SsrfError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'SsrfError';
    }
  }
  return { assertSafeUrl: vi.fn(), SsrfError };
});

import { assertSafeUrl, SsrfError } from '../../src/utils/ssrf.js';
import { createGenerateHandler } from '../../src/routes/pdf/handler.js';
import type { PdfService } from '../../src/services/pdf/PdfService.js';
import type { StorageService } from '../../src/services/storage/StorageService.js';
import type { MetricsService } from '../../src/services/metrics/MetricsService.js';

const mockAssertSafeUrl = vi.mocked(assertSafeUrl);

const STORED_PDF = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
};

function createReply() {
  const reply = {
    send: vi.fn(),
    code: vi.fn(),
    status: vi.fn(),
    header: vi.fn(),
    badRequest: vi.fn(),
  };
  // Fastify's reply API is chainable: every method returns the reply.
  reply.send.mockReturnValue(reply);
  reply.code.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);
  reply.header.mockReturnValue(reply);
  reply.badRequest.mockReturnValue(reply);
  return reply;
}

function makeServices() {
  const pdfService = { generate: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')) };
  const storageService = { upload: vi.fn().mockResolvedValue(STORED_PDF) };
  const metricsService = { recordSuccess: vi.fn(), recordError: vi.fn() };
  return { pdfService, storageService, metricsService };
}

function buildHandler(services = makeServices()) {
  const handler = createGenerateHandler(
    services.pdfService as unknown as PdfService,
    services.storageService as unknown as StorageService,
    services.metricsService as unknown as MetricsService,
  );
  return { handler, ...services };
}

function call(
  handler: ReturnType<typeof createGenerateHandler>,
  body: Record<string, unknown>,
) {
  const reply = createReply();
  const promise = handler({ body } as unknown as FastifyRequest as never, reply as unknown as FastifyReply);
  return { reply, promise };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAssertSafeUrl.mockResolvedValue(undefined);
});

describe('createGenerateHandler — input validation (html XOR url)', () => {
  it('rejects a request with neither html nor url', async () => {
    const { handler, pdfService } = buildHandler();
    const { reply, promise } = call(handler, {});
    await promise;
    expect(reply.badRequest).toHaveBeenCalledWith('Provide either html or url');
    expect(pdfService.generate).not.toHaveBeenCalled();
  });

  it('rejects a request with both html and url', async () => {
    const { handler, pdfService } = buildHandler();
    const { reply, promise } = call(handler, { html: 'x', url: 'https://example.com' });
    await promise;
    expect(reply.badRequest).toHaveBeenCalledWith('Provide either html or url, not both');
    expect(pdfService.generate).not.toHaveBeenCalled();
  });
});

describe('createGenerateHandler — SSRF guard', () => {
  it('returns 400 and skips generation when the URL is blocked', async () => {
    mockAssertSafeUrl.mockRejectedValue(new SsrfError('blocked: 10.0.0.1'));
    const { handler, pdfService } = buildHandler();
    const { reply, promise } = call(handler, { url: 'https://internal.example.com' });
    await promise;
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 400, error: 'blocked: 10.0.0.1' });
    expect(pdfService.generate).not.toHaveBeenCalled();
  });

  it('proceeds to generation when the URL passes the SSRF check', async () => {
    const { handler, pdfService } = buildHandler();
    const { promise } = call(handler, { url: 'https://example.com' });
    await promise;
    expect(mockAssertSafeUrl).toHaveBeenCalledWith('https://example.com');
    expect(pdfService.generate).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-SSRF errors from the safety check', async () => {
    mockAssertSafeUrl.mockRejectedValue(new Error('dns boom'));
    const { handler } = buildHandler();
    const { promise } = call(handler, { url: 'https://example.com' });
    await expect(promise).rejects.toThrow('dns boom');
  });
});

describe('createGenerateHandler — success paths', () => {
  it('uploads and returns the stored pdf for a non-stream request', async () => {
    const { handler, pdfService, storageService, metricsService } = buildHandler();
    const { reply, promise } = call(handler, { html: '<h1>hi</h1>' });
    await promise;
    expect(pdfService.generate).toHaveBeenCalledWith({ html: '<h1>hi</h1>' });
    expect(storageService.upload).toHaveBeenCalledWith(expect.any(Buffer));
    expect(metricsService.recordSuccess).toHaveBeenCalledTimes(1);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 200, data: STORED_PDF });
  });

  it('streams the pdf inline and skips upload when stream=true', async () => {
    const { handler, storageService, metricsService } = buildHandler();
    const { reply, promise } = call(handler, { html: 'x', stream: true });
    await promise;
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="document.pdf"',
    );
    expect(reply.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(storageService.upload).not.toHaveBeenCalled();
    expect(metricsService.recordSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('createGenerateHandler — error path', () => {
  it('records an error metric and re-throws when generation fails', async () => {
    const services = makeServices();
    services.pdfService.generate.mockRejectedValue(new Error('boom'));
    const { handler, metricsService } = buildHandler(services);
    const { promise } = call(handler, { html: 'x' });
    await expect(promise).rejects.toThrow('boom');
    expect(metricsService.recordError).toHaveBeenCalledTimes(1);
    expect(metricsService.recordSuccess).not.toHaveBeenCalled();
  });
});
