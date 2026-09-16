import { createApp } from './app';
import { connectDB, disconnectDB } from './config/db';
import { initRedis } from './config/redis';
import { env, isProd } from './config/env';
import { runRetention } from './services/retention.service';
import { refreshAllSubscriptionNotifications } from './services/notification.service';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  await connectDB();
  initRedis();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`[server] ${env.NODE_ENV} — http://localhost:${env.PORT}${env.API_PREFIX}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[server] port ${env.PORT} is already in use. Kill the stale process or change PORT.`);
    } else {
      logger.error('[server] listen error', err.message);
    }
    void disconnectDB();
    process.exit(1);
  });

  // Daily maintenance: 6-month retention + account-expiry notifications.
  const maintenance = setInterval(async () => {
    try {
      await runRetention();
      await refreshAllSubscriptionNotifications();
    } catch (err) {
      logger.error('[maintenance]', (err as Error).message);
    }
  }, 24 * 60 * 60 * 1000);
  if (!isProd) maintenance.unref();

  const shutdown = async (signal: string) => {
    logger.info(`[server] received ${signal}, shutting down…`);
    clearInterval(maintenance);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('[bootstrap] fatal', err);
  process.exit(1);
});