import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './server.js';

function buildProxy() {
  return buildApp().then((app) => awsLambdaFastify(app, { binaryMimeTypes: ['application/pdf'] }));
}

type ProxyPromise = ReturnType<typeof buildProxy>;
type Proxy = Awaited<ProxyPromise>;

// Cache the built proxy for warm-invocation reuse (browser stays alive), but
// reset the cache if init fails so a transient buildApp() failure does not wedge
// the instance permanently — the next invocation retries instead of awaiting a
// forever-rejected promise.
let proxyPromise: ProxyPromise | null = null;

function getProxy(): ProxyPromise {
  if (proxyPromise === null) {
    proxyPromise = buildProxy().catch((err: unknown) => {
      proxyPromise = null;
      throw err;
    });
  }
  return proxyPromise;
}

// Eagerly start init at module load for warm-start browser reuse. Swallow the
// rejection here (the handler retries via getProxy) to avoid an unhandled rejection.
void getProxy().catch(() => {});

export const handler = async (
  event: Parameters<Proxy>[0],
  context: Parameters<Proxy>[1],
) => {
  const proxy = await getProxy();
  return proxy(event, context);
};
