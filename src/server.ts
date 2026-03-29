import Fastify from 'fastify';
import { env } from './config/env.js';
import { s3Plugin } from './plugins/s3.js';
import { sensiblePlugin } from './plugins/sensible.js';
import { pdfRoutes } from './routes/pdf/index.js';
import { PdfService } from './services/pdf/PdfService.js';
import { StorageService } from './services/storage/StorageService.js';

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

  await fastify.register(sensiblePlugin);
  await fastify.register(s3Plugin);
  await fastify.register(pdfRoutes, {
    pdfService,
    storageService: new StorageService(fastify.s3, fastify.s3Public),
  });

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
