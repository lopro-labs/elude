import { config } from './config.js';
import { buildServer } from './server.js';
import { cameraStore } from './cameras/store.js';
import { ghHealth, selfTestMultiPolygon } from './routing/graphhopper.js';

async function main(): Promise<void> {
  const app = await buildServer({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  // Camera store: non-blocking. Requests served from cache/fallback while Overpass runs.
  cameraStore.setLogger(
    (m) => app.log.info(m),
    (m) => app.log.warn(m),
  );
  void cameraStore
    .start()
    .then(() => app.log.info(cameraStore.stats(), 'camera store ready'))
    .catch((err) => app.log.error({ err }, 'camera store failed to start'));

  // Probe GraphHopper in the background; run the MultiPolygon self-test on first success.
  void (async () => {
    const gh = await ghHealth();
    if (gh.ok) {
      app.log.info(`graphhopper: reachable at ${config.ghUrl}`);
      await selfTestMultiPolygon(undefined, (m) => app.log.info(m));
    } else {
      app.log.warn(`graphhopper: not reachable at ${config.ghUrl} (${gh.message ?? 'unknown'}) – routing disabled until it is up`);
    }
  })();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    { dataDir: config.dataDir, regionBbox: config.regionBbox, gh: config.ghUrl },
    `Elude API listening on :${config.port}`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    cameraStore.stop();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
