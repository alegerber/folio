import Fastify from 'fastify';
import { env } from './config/env.js';
import { authPlugin } from './plugins/auth.js';
import { s3Plugin } from './plugins/s3.js';
import { sensiblePlugin } from './plugins/sensible.js';
import { healthRoutes } from './routes/health/index.js';
import { pdfRoutes } from './routes/pdf/index.js';
import { metricsRoutes } from './routes/metrics/index.js';
import { PdfService } from './services/pdf/PdfService.js';
import { StorageService } from './services/storage/StorageService.js';
import { MetricsService } from './services/metrics/MetricsService.js';

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

  await fastify.register(sensiblePlugin);
  await fastify.register(authPlugin);
  await fastify.register(s3Plugin);
  await fastify.register(healthRoutes);
  await fastify.register(pdfRoutes, {
    pdfService,
    storageService: new StorageService(fastify.s3, fastify.s3Public),
    metricsService,
  });
  await fastify.register(metricsRoutes, { metricsService });

  fastify.addHook('onReady', async () => {
    // Warm up the browser on startup to reduce first-request latency
    try {
      await pdfService.getBrowser();
      fastify.log.info('Browser warmed up successfully');
    } catch (err) {
      fastify.log.warn({ err }, 'Failed to warm up browser — will retry on first request');
    }
  });

  fastify.addHook('onClose', async () => {
    await pdfService.close();
  });

  return fastify;
}
