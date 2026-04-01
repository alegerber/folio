import type { FastifyPluginAsync } from 'fastify';
import { healthHandler } from './handler.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', {
    handler: healthHandler,
  });
};
