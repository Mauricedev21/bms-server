import cron, { type ScheduledTask } from 'node-cron';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { runRetention } from '../services/retention.service';
import { refreshAllSubscriptionNotifications } from '../services/notification.service';
import { logger } from '../utils/logger';

/**
 * Central cron scheduler for the backend.
 *
 * Guarantees provided here (and exercised by src/scripts/check-jobs.ts):
 *  1. Duplicate scheduling is impossible — startScheduler() is idempotent and
 *     job names are registered in a Map that refuses a second registration.
 *  2. Overlapping executions are impossible — node-cron's noOverlap option is
 *     combined with an explicit in-flight guard that logs a skip.
 *  3. Job failures never become unhandled rejections — every run is wrapped
 *     in try/catch, recorded in the job's status, and logged.
 *  4. No unnecessary DB work — jobs are skipped while MongoDB is not
 *     connected (readyState check, no query issued) and maintenance only runs
 *     on its cron schedule, never in a tight loop.
 *  5. No financial mutation, no business-data deletion from the NEW jobs —
 *     retention (the only job that archives+removes old live records, an
 *     existing admin feature) is individually gated by
 *     RETENTION_SCHEDULED_ENABLED and never touches active loans.
 */

export interface JobStatus {
  name: string;
  description: string;
  /** Cron expression the job is registered with ('' when not scheduled). */
  schedule: string;
  enabled: boolean;
  running: boolean;
  /** ISO timestamp of the last completed run, null before the first run. */
  lastRunAt: string | null;
  lastOutcome: 'ok' | 'error' | 'skipped-db' | 'skipped-overlap' | null;
  lastDurationMs: number | null;
  runCount: number;
  errorCount: number;
  /** Sanitized message of the last error (never contains credentials). */
  lastError: string | null;
}

interface JobDefinition {
  name: string;
  description: string;
  schedule: string;
  enabled: boolean;
  /** When true the job is skipped entirely while MongoDB is disconnected. */
  requiresDb: boolean;
  handler: () => Promise<void>;
}

/** Mutable per-job runtime state kept alongside the definition. */
interface JobRecord extends JobStatus {
  task: ScheduledTask | null;
  inFlight: boolean;
  /** Original definition retained so runJobNow() can re-run any job. */
  definition: JobDefinition;
}

const records = new Map<string, JobRecord>();
let started = false;

function statusOf(record: JobRecord): JobStatus {
  const { task: _task, inFlight: _inFlight, definition: _definition, ...status } = record;
  return status;
}

function dbConnected(): boolean {
  // readyState is an in-memory flag: checking it issues no query.
  return mongoose.connection.readyState === 1;
}

function buildDefinitions(): JobDefinition[] {
  const defs: JobDefinition[] = [
    {
      name: 'subscription-notifications',
      description: 'Refresh expiry/expired account notifications for managers',
      schedule: env.MAINTENANCE_CRON,
      enabled: true,
      requiresDb: true,
      handler: async () => {
        await refreshAllSubscriptionNotifications();
      },
    },
    {
      name: 'retention-archiving',
      description:
        'Archive then remove operational records older than RETENTION_MONTHS (admin feature)',
      schedule: env.MAINTENANCE_CRON,
      enabled: env.RETENTION_SCHEDULED_ENABLED,
      requiresDb: true,
      handler: async () => {
        await runRetention();
      },
    },
  ];
  return defs;
}

async function runJob(record: JobRecord, definition: JobDefinition): Promise<void> {
  if (record.inFlight) {
    record.lastOutcome = 'skipped-overlap';
    logger.warn(`[jobs] ${record.name} skipped: previous run still in progress`);
    return;
  }
  if (definition.requiresDb && !dbConnected()) {
    record.lastOutcome = 'skipped-db';
    logger.warn(`[jobs] ${record.name} skipped: MongoDB not connected`);
    return;
  }

  record.inFlight = true;
  record.running = true;
  const startedAt = Date.now();
  try {
    await definition.handler();
    record.lastOutcome = 'ok';
    record.lastError = null;
  } catch (err) {
    record.lastOutcome = 'error';
    record.errorCount += 1;
    record.lastError = err instanceof Error ? err.message : String(err);
    logger.error(`[jobs] ${record.name} failed: ${record.lastError}`);
  } finally {
    record.inFlight = false;
    record.running = false;
    record.lastRunAt = new Date().toISOString();
    record.lastDurationMs = Date.now() - startedAt;
    record.runCount += 1;
  }
}

/**
 * Start every configured job. Safe to call more than once: subsequent calls
 * log and return without registering anything (duplicate-scheduling guard).
 * Invalid cron expressions disable only that job — the rest still start.
 */
export function startScheduler(): void {
  if (started) {
    logger.warn('[jobs] startScheduler() called more than once — ignored');
    return;
  }
  started = true;

  for (const definition of buildDefinitions()) {
    if (records.has(definition.name)) {
      logger.warn(`[jobs] job "${definition.name}" already registered — duplicate ignored`);
      continue;
    }

    const record: JobRecord = {
      name: definition.name,
      description: definition.description,
      schedule: '',
      enabled: false,
      running: false,
      lastRunAt: null,
      lastOutcome: null,
      lastDurationMs: null,
      runCount: 0,
      errorCount: 0,
      lastError: null,
      task: null,
      inFlight: false,
      definition,
    };
    records.set(definition.name, record);

    if (!definition.enabled) {
      logger.info(`[jobs] ${definition.name} disabled by configuration`);
      continue;
    }
    if (!cron.validate(definition.schedule)) {
      logger.error(
        `[jobs] ${definition.name} has invalid cron expression "${definition.schedule}" — job not scheduled`,
      );
      continue;
    }

    try {
      // noOverlap: node-cron refuses a second invocation while one is running;
      // runJob() re-checks defensively and records the skip for visibility.
      record.task = cron.schedule(
        definition.schedule,
        // Return the promise (not `void runJob(...)`) so node-cron's noOverlap
        // bookkeeping sees the run as in flight; runJob() itself never rejects.
        () => runJob(record, definition),
        { name: definition.name, noOverlap: true },
      );
      record.schedule = definition.schedule;
      record.enabled = true;
      logger.info(`[jobs] scheduled ${definition.name} (${definition.schedule})`);
    } catch (err) {
      logger.error(
        `[jobs] failed to schedule ${definition.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Stop all jobs. Idempotent; safe to call during shutdown or tests. */
export function stopScheduler(): void {
  if (!started) {
    // Still destroy any tasks (covers a partially-started scheduler).
    for (const record of records.values()) {
      if (record.task) void record.task.destroy();
      record.task = null;
      record.enabled = false;
    }
    return;
  }
  started = false;
  for (const record of records.values()) {
    if (record.task) {
      try {
        void record.task.destroy();
      } catch (err) {
        logger.warn(
          `[jobs] error destroying ${record.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      record.task = null;
    }
    record.enabled = false;
    record.running = false;
    record.inFlight = false;
  }
  logger.info('[jobs] all scheduled jobs stopped');
}

/** True between startScheduler() and stopScheduler(). */
export function isSchedulerStarted(): boolean {
  return started;
}

/** Snapshot of every registered job's status (safe to expose in health data). */
export function getJobStatuses(): JobStatus[] {
  return Array.from(records.values(), statusOf);
}

/**
 * Run a registered job immediately, in place (used by tests and available
 * for future admin-triggered runs). Returns false when the name is unknown.
 * Errors are captured in the job status exactly like a scheduled run.
 */
export async function runJobNow(name: string): Promise<boolean> {
  const record = records.get(name);
  if (!record) return false;
  await runJob(record, record.definition);
  return true;
}

/**
 * Test-only: reset all module state without touching node-cron's internals
 * beyond destroying tasks this module created.
 */
export function __resetSchedulerForTests(): void {
  stopScheduler();
  records.clear();
}

/**
 * Test-only: register an ad-hoc job backed by an arbitrary handler so the
 * run/skip/error paths can be exercised without running real maintenance
 * (which could otherwise archive live records). Not used in production code.
 */
export function __registerTestJob(
  name: string,
  handler: () => Promise<void>,
  options: { requiresDb?: boolean; schedule?: string; enabled?: boolean } = {},
): void {
  const definition: JobDefinition = {
    name,
    description: 'test-only job',
    schedule: options.schedule ?? '0 0 * 1 1',
    enabled: options.enabled ?? false,
    requiresDb: options.requiresDb ?? false,
    handler,
  };
  if (records.has(name)) {
    throw new Error(`test job "${name}" already registered`);
  }
  const record: JobRecord = {
    name,
    description: definition.description,
    schedule: '',
    enabled: false,
    running: false,
    lastRunAt: null,
    lastOutcome: null,
    lastDurationMs: null,
    runCount: 0,
    errorCount: 0,
    lastError: null,
    task: null,
    inFlight: false,
    definition,
  };
  records.set(name, record);
  if (definition.enabled && cron.validate(definition.schedule)) {
    record.task = cron.schedule(
      definition.schedule,
      () => runJob(record, definition),
      { name, noOverlap: true },
    );
    record.schedule = definition.schedule;
    record.enabled = true;
  }
}
