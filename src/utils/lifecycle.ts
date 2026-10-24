import type { Server } from 'http';
import { logger } from './logger';

/**
 * Testable graceful-shutdown helper.
 *
 * Order of operations (each step is individually guarded so one failure can
 * never strand the process):
 *   1. stopJobScheduler / stopKeepAlive — no new work is accepted.
 *   2. server.close() — stop accepting connections (force-exit fallback).
 *   3. disconnectDb() — release the MongoDB connection.
 *   4. exit(0)
 *
 * Re-entrant calls (e.g. SIGTERM + SIGINT arriving together) collapse into a
 * single shutdown, so listeners, timers and DB disconnects run exactly once.
 */

export interface ShutdownOptions {
  /** The real http.Server (or a stub in tests). */
  server: Pick<Server, 'close'> & { closeIdleConnections?: () => void };
  stopJobScheduler: () => void;
  stopKeepAlive: () => void;
  disconnectDb: () => Promise<void>;
  /** Milliseconds to wait for server.close() before forcing exit. */
  closeTimeoutMs?: number;
  /** Injected for tests; defaults to process.exit. */
  exit?: (code: number) => void;
}

export type ShutdownFn = (signal: string) => Promise<void>;

export function createShutdownHandler(options: ShutdownOptions): ShutdownFn {
  const {
    server,
    stopJobScheduler,
    stopKeepAlive,
    disconnectDb,
    closeTimeoutMs = 10_000,
    exit = (code: number) => process.exit(code),
  } = options;

  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      logger.warn(`[server] ${signal} received during shutdown — already in progress`);
      return;
    }
    shuttingDown = true;
    logger.info(`[server] ${signal} received — graceful shutdown started`);

    // 1. Stop background work first so nothing runs during teardown.
    try {
      stopJobScheduler();
    } catch (err) {
      logger.error(`[server] stopJobScheduler failed: ${(err as Error).message}`);
    }
    try {
      stopKeepAlive();
    } catch (err) {
      logger.error(`[server] stopKeepAlive failed: ${(err as Error).message}`);
    }

    // 2. Close the HTTP server; force-exit if open connections hang.
    let forceExited = false;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        logger.error(`[server] close timed out after ${closeTimeoutMs}ms — forcing exit(1)`);
        if (settled) return;
        settled = true;
        forceExited = true;
        exit(1);
        resolve(); // no-op in production (process.exit never returns); keeps injected exits testable
      }, closeTimeoutMs);
      timer.unref?.();
      server.close(() => done());
      // Idle keep-alive sockets (uptime monitors, load balancers) would
      // otherwise hold server.close() open for their full keep-alive timeout.
      // Closing only IDLE connections lets in-flight requests drain normally.
      try {
        server.closeIdleConnections?.();
      } catch {
        // Node < 18.2 or already closed — the force-exit timer is the backstop.
      }
    });

    // A forced exit is terminal: do not continue teardown (which would end in
    // a contradictory second exit). In production process.exit already ended
    // the process; the flag keeps injected exits (tests) well-defined.
    if (forceExited) return;

    // 3. Disconnect the database.
    try {
      await disconnectDb();
      logger.info('[server] database disconnected');
    } catch (err) {
      logger.error(`[server] disconnectDB failed: ${(err as Error).message}`);
    }

    logger.info('[server] shutdown complete');
    exit(0);
  };
}
