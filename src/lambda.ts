import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './server.js';

// buildApp() is called at module level (outside the handler) so the browser
// is launched once and reused across warm invocations.
const proxyPromise = buildApp().then((app) =>
  awsLambdaFastify(app, { binaryMimeTypes: ['application/pdf'] }),
);

// Derive the handler's parameter types from the proxy itself instead of casting
// `unknown`, so event/context stay type-checked against @fastify/aws-lambda.
type Proxy = Awaited<typeof proxyPromise>;

export const handler = async (
  event: Parameters<Proxy>[0],
  context: Parameters<Proxy>[1],
) => {
  const proxy = await proxyPromise;
  return proxy(event, context);
};
