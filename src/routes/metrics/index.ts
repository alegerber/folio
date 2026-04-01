import type { FastifyPluginAsync } from 'fastify';
import type { MetricsService } from '../../services/metrics/MetricsService.js';

interface MetricsRouteOptions {
  metricsService: MetricsService;
}

export const metricsRoutes: FastifyPluginAsync<MetricsRouteOptions> = async (
  fastify,
  { metricsService },
) => {
  fastify.get('/metrics', async (_request, reply) => {
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(metricsService.format());
  });
};
