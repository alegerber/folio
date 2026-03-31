import type { FastifyPluginAsync } from 'fastify';
import {
  generateRequestJsonSchema,
  pdfIdParamsJsonSchema,
  mergeRequestJsonSchema,
} from './schema.js';
import {
  createGenerateHandler,
  createGetHandler,
  createDeleteHandler,
  createMergeHandler,
} from './handler.js';
import type { PdfService } from '../../services/pdf/PdfService.js';
import type { StorageService } from '../../services/storage/StorageService.js';

interface PdfRouteOptions {
  pdfService: PdfService;
  storageService: StorageService;
}

export const pdfRoutes: FastifyPluginAsync<PdfRouteOptions> = async (
  fastify,
  { pdfService, storageService },
) => {
  fastify.post('/pdf/generate', {
    schema: { body: generateRequestJsonSchema },
    handler: createGenerateHandler(pdfService, storageService),
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
};
