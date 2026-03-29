import awsLambdaFastify from 'aws-lambda-fastify';
import { buildApp } from './server.js';

// buildApp() is called at module level (outside the handler) so the browser
// is launched once and reused across warm invocations.
const proxyPromise = buildApp().then((app) => awsLambdaFastify(app));

export const handler = (event: unknown, context: unknown, callback: unknown) => {
  return proxyPromise.then((proxy) =>
    proxy(
      event as Parameters<typeof proxy>[0],
      context as Parameters<typeof proxy>[1],
      callback as Parameters<typeof proxy>[2],
    ),
  );
};
