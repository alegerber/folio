import awsLambdaFastify from 'aws-lambda-fastify';
import { buildApp } from './server.js';

// buildApp() is called at module level (outside the handler) so the browser
// is launched once and reused across warm invocations.
const proxyPromise = buildApp().then((app) => awsLambdaFastify(app));

export const handler = async (event: unknown, context: unknown) => {
  const proxy = await proxyPromise;
  return proxy(event as Parameters<typeof proxy>[0], context as Parameters<typeof proxy>[1]);
};
