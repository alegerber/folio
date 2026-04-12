import Fastify from 'fastify';
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
    logger: {
      level: env.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty' }
          : undefined,
    },
  });

  const pdfService = new PdfService();
  const metricsService = new MetricsService();
  const opsService = new PdfOperationsService(env.GHOSTSCRIPT_PATH);
  const screenshotService = new ScreenshotService(pdfService);

  await fastify.register(sensiblePlugin);
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
