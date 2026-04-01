import { timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

export const authPlugin = fp(async (fastify) => {
  if (!env.API_KEY) return;

  const expected = Buffer.from(env.API_KEY);

  fastify.addHook('onRequest', async (request, reply) => {
    const key = request.headers['x-api-key'];
    const provided = Buffer.from(typeof key === 'string' ? key : '');

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
  });
});
