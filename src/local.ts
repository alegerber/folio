import { buildApp } from './server.js';
import { env } from './config/env.js';

// Wrapped in an IIFE rather than top-level await because esbuild bundles this
// entrypoint to CJS, which does not support top-level await.
(async () => {
  const app = await buildApp();

  // Close the app (and via its onClose hook, the Chromium browser) on the
  // signals a container runtime sends, so `docker stop` doesn't orphan Chromium.
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    app.log.info({ signal }, 'Received shutdown signal, closing server');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during graceful shutdown');
      process.exit(1);
    }
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
})();
