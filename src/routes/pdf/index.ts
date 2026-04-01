import type { FastifyPluginAsync } from 'fastify';
import {
  generateRequestJsonSchema,
  pdfIdParamsJsonSchema,
  mergeRequestJsonSchema,
  splitRequestJsonSchema,
  compressRequestJsonSchema,
  pdfARequestJsonSchema,
} from './schema.js';
import {
  createGenerateHandler,
  createGetHandler,
  createDeleteHandler,
  createMergeHandler,
  createSplitHandler,
  createCompressHandler,
  createPdfAHandler,
} from './handler.js';
import type { PdfService } from '../../services/pdf/PdfService.js';
import type { StorageService } from '../../services/storage/StorageService.js';
import type { MetricsService } from '../../services/metrics/MetricsService.js';
import type { PdfOperationsService } from '../../services/pdf/PdfOperationsService.js';

interface PdfRouteOptions {
  pdfService: PdfService;
  storageService: StorageService;
  metricsService: MetricsService;
  opsService: PdfOperationsService;
}

export const pdfRoutes: FastifyPluginAsync<PdfRouteOptions> = async (
  fastify,
  { pdfService, storageService, metricsService, opsService },
) => {
  fastify.post('/pdf/generate', {
    schema: {
      body: generateRequestJsonSchema,
    },
    handler: createGenerateHandler(pdfService, storageService, metricsService),
  });

  fastify.get('/pdf/:id', {
    schema: { params: pdfIdParamsJsonSchema },
    handler: createGetHandler(storageService),
  });

  fastify.delete('/pdf/:id', {
    schema: { params: pdfIdParamsJsonSchema },
    handler: createDeleteHandler(storageService),
  });

  fastify.post('/pdf/merge', {
    schema: { body: mergeRequestJsonSchema },
    handler: createMergeHandler(storageService),
  });

  fastify.post('/pdf/split', {
    schema: { body: splitRequestJsonSchema },
    handler: createSplitHandler(storageService, opsService),
  });

  fastify.post('/pdf/compress', {
    schema: { body: compressRequestJsonSchema },
    handler: createCompressHandler(storageService, opsService),
  });

  if (opsService.canUseGhostscript) {
    fastify.post('/pdf/pdfa', {
      schema: { body: pdfARequestJsonSchema },
      handler: createPdfAHandler(storageService, opsService),
    });
  }
};
