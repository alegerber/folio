import { timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

// Unauthenticated paths. Health must be reachable by load balancers / container
// orchestrators that cannot send the API key. /metrics stays protected so
// operational data is not exposed publicly (configure scrapers with the key).
const PUBLIC_PATHS = new Set(['/health']);

export const authPlugin = fp(async (fastify) => {
  if (!env.API_KEY) return;

  const expected = Buffer.from(env.API_KEY);

  fastify.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0];
    if (PUBLIC_PATHS.has(path)) return;

    const key = request.headers['x-api-key'];
    const provided = Buffer.from(typeof key === 'string' ? key : '');

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
  });
});
