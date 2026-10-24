import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { getJobStatuses } from '../jobs/scheduler';
import { getKeepAliveStatus } from '../jobs/keepAlive';

const router = Router();

// Map mongoose readyState (0-3) to a label. This reads an in-memory flag —
// the health endpoint intentionally issues NO database query, so it stays
// lightweight and answers even while MongoDB is unreachable.
const DB_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * GET /api/health — lightweight liveness/readiness probe.
 *
 * Exposes only operational, non-sensitive facts: service name, status,
 * environment, uptime, ISO time, database connection state (a label, never a
 * URI/credential), registered background-job counts and whether keep-alive is
 * on. It never returns env values, tokens, paths, headers or any other
 * secret, and it issues no database query.
 *
 * Mounted in app.ts BEFORE the /api rate limiter so external uptime monitors
 * can poll it on their own schedule without ever being throttled.
 */
router.get('/', (_req, res) => {
  const dbState = DB_STATES[mongoose.connection.readyState] ?? 'unknown';
  const jobs = getJobStatuses();
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'bms-api',
      environment: env.NODE_ENV,
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      database: dbState,
      scheduledJobs: {
        count: jobs.length,
        enabled: jobs.filter((j) => j.enabled).length,
        running: jobs.filter((j) => j.running).length,
      },
      keepAlive: { enabled: getKeepAliveStatus().enabled },
    },
  });
});

export default router;
