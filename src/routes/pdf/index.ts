import type { FastifyPluginAsync } from 'fastify';
import { generateRequestJsonSchema } from './schema.js';
import { createGenerateHandler } from './handler.js';
import type { PdfService } from '../../services/pdf/PdfService.js';
import type { StorageService } from '../../services/storage/StorageService.js';
import type { MetricsService } from '../../services/metrics/MetricsService.js';

interface PdfRouteOptions {
  pdfService: PdfService;
  storageService: StorageService;
  metricsService: MetricsService;
}

export const pdfRoutes: FastifyPluginAsync<PdfRouteOptions> = async (
  fastify,
  { pdfService, storageService, metricsService },
) => {
  fastify.post('/pdf/generate', {
    schema: {
      body: generateRequestJsonSchema,
    },
    handler: createGenerateHandler(pdfService, storageService, metricsService),
  });
};
