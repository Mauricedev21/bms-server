"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const db_1 = require("./config/db");
const redis_1 = require("./config/redis");
const env_1 = require("./config/env");
const retention_service_1 = require("./services/retention.service");
const notification_service_1 = require("./services/notification.service");
const logger_1 = require("./utils/logger");
async function bootstrap() {
    await (0, db_1.connectDB)();
    (0, redis_1.initRedis)();
    const app = (0, app_1.createApp)();
    const server = app.listen(env_1.env.PORT, () => {
        logger_1.logger.info(`[server] ${env_1.env.NODE_ENV} — http://localhost:${env_1.env.PORT}${env_1.env.API_PREFIX}`);
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger_1.logger.error(`[server] port ${env_1.env.PORT} is already in use. Kill the stale process or change PORT.`);
        }
        else {
            logger_1.logger.error('[server] listen error', err.message);
        }
        void (0, db_1.disconnectDB)();
        process.exit(1);
    });
    // Daily maintenance: 6-month retention + account-expiry notifications.
    const maintenance = setInterval(async () => {
        try {
            await (0, retention_service_1.runRetention)();
            await (0, notification_service_1.refreshAllSubscriptionNotifications)();
        }
        catch (err) {
            logger_1.logger.error('[maintenance]', err.message);
        }
    }, 24 * 60 * 60 * 1000);
    if (!env_1.isProd)
        maintenance.unref();
    const shutdown = async (signal) => {
        logger_1.logger.info(`[server] received ${signal}, shutting down…`);
        clearInterval(maintenance);
        server.close(async () => {
            await (0, db_1.disconnectDB)();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}
bootstrap().catch((err) => {
    logger_1.logger.error('[bootstrap] fatal', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map