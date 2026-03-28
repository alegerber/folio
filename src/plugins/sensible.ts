import sensible from '@fastify/sensible';
import fp from 'fastify-plugin';

export const sensiblePlugin = fp(async (fastify) => {
  await fastify.register(sensible);
});
