import { STATUS_CODES } from 'node:http';
import Fastify, { type FastifyError } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { authPlugin } from './plugins/auth.js';
import { s3Plugin } from './plugins/s3.js';
import { sensiblePlugin } from './plugins/sensible.js';
import { healthRoutes } from './routes/health/index.js';
import { pdfRoutes } from './routes/pdf/index.js';
import { metricsRoutes } from './routes/metrics/index.js';
import { screenshotRoutes } from './routes/screenshot/index.js';
import { PdfService } from './services/pdf/PdfService.js';
import { PdfOperationsService } from './services/pdf/PdfOperationsService.js';
import { StorageService } from './services/storage/StorageService.js';
import { MetricsService } from './services/metrics/MetricsService.js';
import { ScreenshotService } from './services/screenshot/ScreenshotService.js';

export async function buildApp() {
  const fastify = Fastify({
    // Cap request bodies (html/css/cookies) regardless of per-field limits.
    bodyLimit: 10 * 1024 * 1024,
    logger: {
      level: env.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty' }
          : undefined,
    },
  });

  // Mask 5xx detail (Fastify's default leaks the error message — including
  // Ghostscript stderr with tmp paths); 4xx client errors keep their message.
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error' });
    }

    return reply.status(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message: error.message,
    });
  });

  const pdfService = new PdfService({ ssrfProtection: env.SSRF_PROTECTION });
  const metricsService = new MetricsService();
  const opsService = new PdfOperationsService(env.GHOSTSCRIPT_PATH);
  const screenshotService = new ScreenshotService(pdfService);

  // Per-route request metrics for every endpoint (merge/split/compress/pdfa/
  // screenshot included), keyed by the route pattern to keep label cardinality
  // bounded; unmatched requests collapse to a single 'unmatched' series.
  fastify.addHook('onResponse', async (request, reply) => {
    metricsService.recordHttpRequest(
      request.routeOptions?.url ?? 'unmatched',
      reply.elapsedTime,
      reply.statusCode,
    );
  });

  await fastify.register(sensiblePlugin);
  // Coarse in-memory rate limit in front of the heavyweight Chromium pipeline.
  // Registered before auth so unauthenticated floods are limited too. Note:
  // per-instance only — on Lambda the effective limit scales with instances.
  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_MAX ?? 60,
    timeWindow: env.RATE_LIMIT_WINDOW_MS ?? 60_000,
  });
  await fastify.register(authPlugin);
  await fastify.register(s3Plugin);
  await fastify.register(healthRoutes);
  await fastify.register(pdfRoutes, {
    pdfService,
    storageService: new StorageService(fastify.s3, fastify.s3Public),
    metricsService,
    opsService,
  });
  await fastify.register(metricsRoutes, { metricsService });
  await fastify.register(screenshotRoutes, {
    screenshotService,
    storageService: new StorageService(fastify.s3, fastify.s3Public),
  });

  fastify.addHook('onReady', async () => {
    // Warm up the browser in the background — don't block the hook since
    // Chromium startup (~7s) can exceed Fastify's onReady timeout.
    pdfService.getBrowser()
      .then(() => fastify.log.info('Browser warmed up successfully'))
      .catch((err) => fastify.log.warn({ err }, 'Failed to warm up browser — will retry on first request'));
  });

  fastify.addHook('onClose', async () => {
    await pdfService.close();
  });

  return fastify;
}
