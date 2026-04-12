import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ScreenshotRequestInput } from './schema.js';
import type { ScreenshotService } from '../../services/screenshot/ScreenshotService.js';
import type { StorageService } from '../../services/storage/StorageService.js';
import { assertSafeUrl, SsrfError } from '../../utils/ssrf.js';
import { env } from '../../config/env.js';

export function createScreenshotHandler(
  screenshotService: ScreenshotService,
  storageService: StorageService,
) {
  return async function screenshotHandler(
    request: FastifyRequest<{ Body: ScreenshotRequestInput }>,
    reply: FastifyReply,
  ) {
    const { stream, ...captureInput } = request.body;

    if (!captureInput.html && !captureInput.url) {
      return reply.badRequest('Provide either html or url');
    }
    if (captureInput.html && captureInput.url) {
      return reply.badRequest('Provide either html or url, not both');
    }

    if (captureInput.url && env.SSRF_PROTECTION) {
      try {
        await assertSafeUrl(captureInput.url);
      } catch (err) {
        if (err instanceof SsrfError) {
          return reply.status(400).send({ statusCode: 400, error: err.message });
        }
        throw err;
      }
    }

    const { buffer, mimeType } = await screenshotService.capture(captureInput);
    const format = captureInput.format ?? 'png';

    if (stream) {
      return reply
        .header('Content-Type', mimeType)
        .header('Content-Disposition', `attachment; filename="screenshot.${format}"`)
        .send(buffer);
    }

    const stored = await storageService.uploadImage(buffer, format, mimeType);
    return reply.send({ statusCode: 200, data: { url: stored.url } });
  };
}
