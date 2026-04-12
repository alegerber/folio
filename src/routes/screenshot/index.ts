import type { FastifyPluginAsync } from 'fastify';
import { screenshotRequestJsonSchema } from './schema.js';
import { createScreenshotHandler } from './handler.js';
import type { ScreenshotService } from '../../services/screenshot/ScreenshotService.js';
import type { StorageService } from '../../services/storage/StorageService.js';

interface ScreenshotRouteOptions {
  screenshotService: ScreenshotService;
  storageService: StorageService;
}

export const screenshotRoutes: FastifyPluginAsync<ScreenshotRouteOptions> = async (
  fastify,
  { screenshotService, storageService },
) => {
  fastify.post('/screenshot', {
    schema: { body: screenshotRequestJsonSchema },
    handler: createScreenshotHandler(screenshotService, storageService),
  });
};
