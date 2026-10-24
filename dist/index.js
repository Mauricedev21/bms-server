"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const db_1 = require("./config/db");
const redis_1 = require("./config/redis");
const env_1 = require("./config/env");
const scheduler_1 = require("./jobs/scheduler");
const keepAlive_1 = require("./jobs/keepAlive");
const lifecycle_1 = require("./utils/lifecycle");
const logger_1 = require("./utils/logger");
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
async function bootstrap() {
    if (bootstrapped) {
        logger_1.logger.warn('[server] bootstrap() called more than once — duplicate listeners not registered');
        return;
    }
    bootstrapped = true;
    await (0, db_1.connectDB)();
    (0, redis_1.initRedis)();
    const app = (0, app_1.createApp)();
    // env.PORT is read from process.env.PORT (Render injects it); the fallback
    // 4000 only applies locally when PORT is unset.
    const server = app.listen(env_1.env.PORT, () => {
        logger_1.logger.info(`[server] ${env_1.env.NODE_ENV} — http://localhost:${env_1.env.PORT}${env_1.env.API_PREFIX}`);
        logger_1.logger.info(`[server] health check: http://localhost:${env_1.env.PORT}${env_1.env.API_PREFIX}/health`);
        // Start background jobs exactly once, only after the server accepted its
        // first bind. Both are idempotent; failures inside jobs are contained.
        (0, scheduler_1.startScheduler)();
        (0, keepAlive_1.startKeepAlive)();
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger_1.logger.error(`[server] port ${env_1.env.PORT} is already in use — another listener owns it. Kill the stale process or change PORT.`);
        }
        else {
            logger_1.logger.error('[server] listen error', err.message);
        }
        (0, scheduler_1.stopScheduler)();
        (0, keepAlive_1.stopKeepAlive)();
        void (0, db_1.disconnectDB)().finally(() => process.exit(1));
    });
    // Refuse to start twice (e.g. accidental double-bootstrap in tests).
    server.once('listening', () => {
        logger_1.logger.debug(`[server] listening (address=${JSON.stringify(server.address())})`);
    });
    const shutdown = (0, lifecycle_1.createShutdownHandler)({
        server,
        stopJobScheduler: scheduler_1.stopScheduler,
        stopKeepAlive: keepAlive_1.stopKeepAlive,
        disconnectDb: db_1.disconnectDB,
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
        logger_1.logger.error('[server] unhandledRejection', message);
        if (env_1.isProd)
            void shutdown('unhandledRejection');
    });
    process.on('uncaughtException', (err) => {
        logger_1.logger.error('[server] uncaughtException', err.message);
        if (env_1.isProd)
            void shutdown('uncaughtException');
    });
}
bootstrap().catch((err) => {
    logger_1.logger.error('[bootstrap] fatal', err instanceof Error ? err.message : err);
    (0, scheduler_1.stopScheduler)();
    (0, keepAlive_1.stopKeepAlive)();
    void (0, db_1.disconnectDB)().finally(() => process.exit(1));
});
//# sourceMappingURL=index.js.map