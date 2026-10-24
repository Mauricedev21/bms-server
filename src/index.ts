import { createApp } from './app';
import { connectDB, disconnectDB } from './config/db';
import { initRedis } from './config/redis';
import { env, isProd } from './config/env';
import { startScheduler, stopScheduler } from './jobs/scheduler';
import { startKeepAlive, stopKeepAlive } from './jobs/keepAlive';
import { createShutdownHandler } from './utils/lifecycle';
import { logger } from './utils/logger';

/**
 * Bootstrap order (each step guarded, jobs start exactly once):
 *   1. connectDB()   — throws on failure; the catch below logs + exit(1).
 *   2. initRedis()   — never throws (falls back to in-memory cache).
 *   3. createApp()   — Express app factory.
 *   4. app.listen()  — EADDRINUSE handled; PORT from process.env (Render).
 *   5. startScheduler() + startKeepAlive() — only AFTER the server is up and
 *      only once; both functions are idempotent so a double call is ignored.
 */

/** Guards against duplicate listener registration if bootstrap is re-entered. */
let bootstrapped = false;

async function bootstrap(): Promise<void> {
  if (bootstrapped) {
    logger.warn('[server] bootstrap() called more than once — duplicate listeners not registered');
    return;
  }
  bootstrapped = true;

  await connectDB();
  initRedis();
  const app = createApp();

  // env.PORT is read from process.env.PORT (Render injects it); the fallback
  // 4000 only applies locally when PORT is unset.
  const server = app.listen(env.PORT, () => {
    logger.info(`[server] ${env.NODE_ENV} — http://localhost:${env.PORT}${env.API_PREFIX}`);
    logger.info(`[server] health check: http://localhost:${env.PORT}${env.API_PREFIX}/health`);

    // Start background jobs exactly once, only after the server accepted its
    // first bind. Both are idempotent; failures inside jobs are contained.
    startScheduler();
    startKeepAlive();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `[server] port ${env.PORT} is already in use — another listener owns it. Kill the stale process or change PORT.`,
      );
    } else {
      logger.error('[server] listen error', err.message);
    }
    stopScheduler();
    stopKeepAlive();
    void disconnectDB().finally(() => process.exit(1));
  });

  // Refuse to start twice (e.g. accidental double-bootstrap in tests).
  server.once('listening', () => {
    logger.debug(`[server] listening (address=${JSON.stringify(server.address())})`);
  });

  const shutdown = createShutdownHandler({
    server,
    stopJobScheduler: stopScheduler,
    stopKeepAlive,
    disconnectDb: disconnectDB,
    closeTimeoutMs: 10_000,
  });

  // Signal handlers are registered once, guaranteed by the bootstrapped guard
  // above (so no duplicate listeners even if bootstrap were re-entered).
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Contain asynchronous failures: log them; in production shut down so a
  // supervisor (Render) restarts from a clean state instead of limping on.
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error('[server] unhandledRejection', message);
    if (isProd) void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error('[server] uncaughtException', err.message);
    if (isProd) void shutdown('uncaughtException');
  });
}

bootstrap().catch((err) => {
  logger.error('[bootstrap] fatal', err instanceof Error ? err.message : err);
  stopScheduler();
  stopKeepAlive();
  void disconnectDB().finally(() => process.exit(1));
});
