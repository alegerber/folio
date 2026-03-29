import { S3Client } from '@aws-sdk/client-s3';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    s3: S3Client;
    s3Public: S3Client;
  }
}

export const s3Plugin = fp(async (fastify) => {
  const credentials =
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined;

  // Internal client — used for uploads, reachable inside Docker/Lambda
  const s3 = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL,
    forcePathStyle: !!env.AWS_ENDPOINT_URL,
    credentials,
  });

  // Public client — used only for presigning; its endpoint ends up in the URL
  // returned to callers. Falls back to the internal endpoint when no public
  // endpoint is configured (i.e. in production with real S3).
  const s3Public = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.AWS_PUBLIC_ENDPOINT_URL ?? env.AWS_ENDPOINT_URL,
    forcePathStyle: !!(env.AWS_PUBLIC_ENDPOINT_URL ?? env.AWS_ENDPOINT_URL),
    credentials,
  });

  fastify.decorate('s3', s3);
  fastify.decorate('s3Public', s3Public);
});
