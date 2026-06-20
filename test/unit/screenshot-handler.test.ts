import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

// Same mocking strategy as the PDF handler: control the SSRF guard and the env
// flag so each branch is exercised without DNS, a browser, or S3.
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
import { createScreenshotHandler } from '../../src/routes/screenshot/handler.js';
import type { ScreenshotService } from '../../src/services/screenshot/ScreenshotService.js';
import type { StorageService } from '../../src/services/storage/StorageService.js';

const mockAssertSafeUrl = vi.mocked(assertSafeUrl);

const STORED_IMAGE = { url: 'https://s3.amazonaws.com/test-bucket/screenshots/test.png?signed=true' };

function createReply() {
  const reply = {
    send: vi.fn(),
    status: vi.fn(),
    header: vi.fn(),
    badRequest: vi.fn(),
  };
  reply.send.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);
  reply.header.mockReturnValue(reply);
  reply.badRequest.mockReturnValue(reply);
  return reply;
}

function makeServices() {
  const screenshotService = {
    capture: vi.fn().mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/png' }),
  };
  const storageService = { uploadImage: vi.fn().mockResolvedValue(STORED_IMAGE) };
  return { screenshotService, storageService };
}

function buildHandler(services = makeServices()) {
  const handler = createScreenshotHandler(
    services.screenshotService as unknown as ScreenshotService,
    services.storageService as unknown as StorageService,
  );
  return { handler, ...services };
}

function call(
  handler: ReturnType<typeof createScreenshotHandler>,
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

describe('createScreenshotHandler — input validation (html XOR url)', () => {
  it('rejects a request with neither html nor url', async () => {
    const { handler, screenshotService } = buildHandler();
    const { reply, promise } = call(handler, {});
    await promise;
    expect(reply.badRequest).toHaveBeenCalledWith('Provide either html or url');
    expect(screenshotService.capture).not.toHaveBeenCalled();
  });

  it('rejects a request with both html and url', async () => {
    const { handler, screenshotService } = buildHandler();
    const { reply, promise } = call(handler, { html: 'x', url: 'https://example.com' });
    await promise;
    expect(reply.badRequest).toHaveBeenCalledWith('Provide either html or url, not both');
    expect(screenshotService.capture).not.toHaveBeenCalled();
  });
});

describe('createScreenshotHandler — SSRF guard', () => {
  it('returns 400 and skips capture when the URL is blocked', async () => {
    mockAssertSafeUrl.mockRejectedValue(new SsrfError('blocked: 169.254.169.254'));
    const { handler, screenshotService } = buildHandler();
    const { reply, promise } = call(handler, { url: 'http://169.254.169.254/' });
    await promise;
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 400, error: 'blocked: 169.254.169.254' });
    expect(screenshotService.capture).not.toHaveBeenCalled();
  });
});

describe('createScreenshotHandler — success paths', () => {
  it('uploads with the default png format and returns the stored url', async () => {
    const { handler, screenshotService, storageService } = buildHandler();
    const { reply, promise } = call(handler, { html: '<h1>hi</h1>' });
    await promise;
    expect(screenshotService.capture).toHaveBeenCalledTimes(1);
    expect(storageService.uploadImage).toHaveBeenCalledWith(expect.any(Buffer), 'png', 'image/png');
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 200, data: { url: STORED_IMAGE.url } });
  });

  it('streams the image inline and skips upload when stream=true', async () => {
    const { handler, storageService } = buildHandler();
    const { reply, promise } = call(handler, { html: 'x', format: 'jpeg', stream: true });
    await promise;
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="screenshot.jpeg"',
    );
    expect(reply.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(storageService.uploadImage).not.toHaveBeenCalled();
  });
});
