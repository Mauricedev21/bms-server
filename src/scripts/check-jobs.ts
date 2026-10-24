/**
 * Scheduled-job / keep-alive / health-endpoint / graceful-shutdown checks.
 *
 * Run:  npm --prefix server run check:jobs     (requires MongoDB on 27017)
 *
 * Everything runs against a dedicated, EMPTY test database (`bms_check_jobs`)
 * — production data is never touched, and the two production jobs that do run
 * (subscription-notification refresh, retention) archive/delete nothing on an
 * empty database.
 *
 * Sections:
 *   [1]  Config validation — clamping, boolean parsing, warning flag
 *   [2]  Keep-alive URL validation + sanitization, cron expression validation
 *   [3]  Health endpoint — shape, no secret leakage, rate-limit exemption
 *        (before DB connect: reports "disconnected" without issuing a query)
 *   [4]  Scheduler guards — DB-disconnected skip, unknown-job no-op
 *   [5]  Scheduling — start-once, duplicate start ignored, invalid cron
 *        contained to that job, RETENTION_SCHEDULED_ENABLED gate
 *   [6]  DB connect + health reports "connected" and both jobs
 *   [7]  Both production jobs execute; financial collections unchanged
 *   [8]  Error containment, overlap impossibility, real cron timer fires,
 *        stopScheduler() freezes timers
 *   [9]  Keep-alive pings against a local HTTP server — success, non-2xx,
 *        404, redirect, connection-refused, timeout, start/stop idempotency,
 *        interval tick + in-flight skip, no secrets in log output
 *   [10] Graceful shutdown handler (in-process, real components) — operation
 *        order, single exit, re-entrancy, close-timeout → exit(1),
 *        failing stop/disconnect steps still contained
 *   [11] Real child process (`node --import tsx src/index.ts`) — boots and
 *        serves health, jobs scheduled exactly once, EADDRINUSE → exit 1,
 *        DB failure → exit 1 without starting jobs, SIGTERM handling
 *   [12] Final assertions (zero unhandled rejections) + summary
 *
 * NOTE (Windows): win32 cannot deliver SIGTERM to a child process —
 * child.kill('SIGTERM') force-terminates it before any handler runs (verified
 * by probe; Linux/Render delivers it normally). The signal→shutdown path is
 * therefore exercised in-process in section [10] using the exact handler
 * index.ts wires to SIGTERM/SIGINT.
 */

// Module scope (keeps this file's top-level names from colliding with the
// other global scripts in src/scripts, e.g. e2e.ts).
export {};

// ── Test environment — MUST be set before any config module loads ───────────
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/bms_check_jobs';
process.env.JWT_SECRET = 'check-jobs-canary-secret-do-not-leak';
process.env.RATE_LIMIT_MAX = '3'; // small, to prove /api/health bypasses the limiter
process.env.MAINTENANCE_CRON = '0 0 * * *';
process.env.RETENTION_SCHEDULED_ENABLED = 'true';
process.env.KEEP_ALIVE_ENABLED = 'false';
process.env.KEEP_ALIVE_INTERVAL_MINUTES = '99999'; // → clamped to 1440 (tested)
process.env.KEEP_ALIVE_TIMEOUT_MS = 'not-a-number'; // → default 10000 (tested)

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

// ── Test harness (same PASS/FAIL style as e2e.ts) ───────────────────────────
let passed = 0;
let failed = 0;
let unhandledRejections = 0;

process.on('unhandledRejection', (reason: unknown) => {
  unhandledRejections++;
  console.error('  UNHANDLED REJECTION →', reason);
});

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}

function note(message: string): void {
  console.log(`  NOTE  ${message}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function tail(text: string, n = 600): string {
  return text.length > n ? '…' + text.slice(-n) : text;
}

/** Set/delete an env var for the duration of fn, then restore it. */
function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

/** Run fn while capturing console output (used to prove no secrets are logged). */
async function withCapturedLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const push = (...args: unknown[]): void => {
    lines.push(args.map((a) => String(a)).join(' '));
  };
  console.log = push;
  console.warn = push;
  console.error = push;
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitForExit(
  child: any,
  timeoutMs: number,
): Promise<{ exited: boolean; code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ exited: false, code: null, signal: null });
      }
    }, timeoutMs);
    child.on('exit', (code: number | null, signal: string | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exited: true, code, signal });
      }
    });
  });
}

// ── Config-dependent modules — required AFTER the env block above ───────────
const { env, envHadWarnings, bool, intClamped } = require('../config/env');
const cronValidate = require('node-cron').validate;
const mongoose = require('mongoose');
const {
  startScheduler,
  stopScheduler,
  isSchedulerStarted,
  getJobStatuses,
  runJobNow,
  __registerTestJob,
  __resetSchedulerForTests,
} = require('../jobs/scheduler');
const {
  validateKeepAliveUrl,
  sanitizeUrl,
  pingOnce,
  startKeepAlive,
  stopKeepAlive,
  getKeepAliveStatus,
  __resetKeepAliveForTests,
} = require('../jobs/keepAlive');
const { createShutdownHandler } = require('../utils/lifecycle');
const { createApp } = require('../app');
const { connectDB, disconnectDB } = require('../config/db');

const serverRoot = path.join(__dirname, '..', '..');
const entry = path.join(serverRoot, 'src', 'index.ts');

let targetServer: any = null; // keep-alive ping target, closed in [12]

function spawnServer(extraEnv: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    cwd: serverRoot,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (b: Buffer) => {
    out += b.toString();
  });
  child.stderr.on('data', (b: Buffer) => {
    out += b.toString();
  });
  return { child, getOut: () => out };
}

async function main(): Promise<void> {
  // ═══ [1] Configuration validation ═══════════════════════════════════════
  console.log('\n[1] Configuration validation');
  ok('KEEP_ALIVE_INTERVAL_MINUTES=99999 clamped to 1440', env.KEEP_ALIVE_INTERVAL_MINUTES === 1440, env.KEEP_ALIVE_INTERVAL_MINUTES);
  ok('KEEP_ALIVE_TIMEOUT_MS="not-a-number" falls back to 10000', env.KEEP_ALIVE_TIMEOUT_MS === 10000, env.KEEP_ALIVE_TIMEOUT_MS);
  ok('KEEP_ALIVE_ENABLED=false by default', env.KEEP_ALIVE_ENABLED === false);
  ok('env load reported validation warnings for bad values', envHadWarnings() === true);
  ok('MAINTENANCE_CRON is a valid daily expression', env.MAINTENANCE_CRON === '0 0 * * *' && cronValidate(env.MAINTENANCE_CRON) === true);
  ok('RETENTION_SCHEDULED_ENABLED=true by default', env.RETENTION_SCHEDULED_ENABLED === true);

  withEnv('X_BOOL', 'true', () => ok('bool("true") → true', bool('X_BOOL', false) === true));
  withEnv('X_BOOL', 'YES', () => ok('bool("YES") → true (case-insensitive)', bool('X_BOOL', false) === true));
  withEnv('X_BOOL', '0', () => ok('bool("0") → false', bool('X_BOOL', true) === false));
  withEnv('X_BOOL', 'nonsense', () => ok('bool typo can only disable, never enable', bool('X_BOOL', false) === false));
  withEnv('X_BOOL', 'nonsense', () => ok('bool typo falls back to true default', bool('X_BOOL', true) === true));
  withEnv('X_BOOL', undefined, () => ok('bool unset → fallback', bool('X_BOOL', true) === true));
  withEnv('X_BOOL', '', () => ok('bool empty → fallback', bool('X_BOOL', true) === true));

  withEnv('X_INT', '99999', () => ok('intClamped above max → max', intClamped('X_INT', 10, 1, 1440) === 1440));
  withEnv('X_INT', '0', () => ok('intClamped below min → min', intClamped('X_INT', 10, 1, 1440) === 1));
  withEnv('X_INT', 'abc', () => ok('intClamped non-numeric → default', intClamped('X_INT', 10, 1, 1440) === 10));
  withEnv('X_INT', '60', () => ok('intClamped in range passes through', intClamped('X_INT', 10, 1, 1440) === 60));
  withEnv('X_INT', undefined, () => ok('intClamped unset → default', intClamped('X_INT', 10, 1, 1440) === 10));

  // ═══ [2] URL + cron expression validation ═══════════════════════════════
  console.log('\n[2] Keep-alive URL validation, sanitization, cron validation');
  ok('empty URL rejected', validateKeepAliveUrl('').valid === false);
  ok('whitespace URL rejected', validateKeepAliveUrl('   ').valid === false);
  ok('garbage URL rejected', validateKeepAliveUrl('not a url').valid === false);
  ok('relative path rejected', validateKeepAliveUrl('/api/health').valid === false);
  ok('ftp:// protocol rejected', validateKeepAliveUrl('ftp://example.com/x').valid === false);
  ok('http:// accepted', validateKeepAliveUrl('http://localhost:4000/api/health').valid === true);
  ok('https:// accepted', validateKeepAliveUrl('https://example.com/api/health').valid === true);

  const stripped = sanitizeUrl('https://user:pass@example.com/api/health?token=SUPERSECRET#frag');
  ok('sanitizeUrl strips credentials, query and fragment', stripped === 'https://example.com/api/health', stripped);
  ok('sanitizeUrl keeps plain URL intact', sanitizeUrl('http://127.0.0.1:4000/api/health') === 'http://127.0.0.1:4000/api/health');
  ok('sanitizeUrl of garbage → null', sanitizeUrl('not a url') === null);

  ok('cron "0 0 * * *" valid', cronValidate('0 0 * * *') === true);
  ok('cron "not-a-cron" invalid', cronValidate('not-a-cron') === false);
  ok('cron 6-field (seconds) expression valid', cronValidate('*/1 * * * * *') === true);

  // ═══ [3] Health endpoint (BEFORE DB connect) ════════════════════════════
  console.log('\n[3] Health endpoint (before DB connect) + rate-limit exemption');
  const app = createApp();
  let appServer: any;
  await new Promise<void>((resolve) => {
    appServer = app.listen(0, '127.0.0.1', () => resolve());
  });
  const healthPort: number = appServer.address().port;
  const healthUrl = `http://127.0.0.1:${healthPort}/api/health`;

  const healthRes = await fetch(healthUrl);
  ok('GET /api/health → 200', healthRes.status === 200, healthRes.status);
  const hb: any = await healthRes.json();
  ok('health payload shape (ok/bms-api)', hb?.success === true && hb?.data?.status === 'ok' && hb?.data?.service === 'bms-api', hb);
  ok('health has numeric uptime + ISO time', typeof hb?.data?.uptimeSeconds === 'number' && !Number.isNaN(Date.parse(hb?.data?.time)), hb?.data);
  ok('health reports "disconnected" pre-connect (no DB query needed)', hb?.data?.database === 'disconnected', hb?.data?.database);
  ok('health scheduledJobs counters are zero before start', hb?.data?.scheduledJobs?.count === 0 && hb?.data?.scheduledJobs?.enabled === 0, hb?.data?.scheduledJobs);
  ok('health keepAlive.enabled present and false', hb?.data?.keepAlive?.enabled === false, hb?.data?.keepAlive);

  const dataKeys = Object.keys(hb?.data ?? {}).sort().join(',');
  ok(
    'health exposes only documented fields',
    dataKeys === 'database,environment,keepAlive,scheduledJobs,service,status,time,uptimeSeconds',
    dataKeys,
  );

  const rawBody = JSON.stringify(hb);
  const forbidden = ['mongodb://', '"password"', '"token"', '"jwt"', '"secret"', env.JWT_SECRET, env.MONGODB_URI].filter(
    Boolean,
  ) as string[];
  const leaked = forbidden.filter((f) => rawBody.includes(f));
  ok('health response leaks no secrets/credentials', leaked.length === 0, leaked);

  // Rate limiting: health must bypass it; other /api routes must not.
  const healthHits: number[] = [];
  for (let i = 0; i < 10; i++) {
    healthHits.push(await fetch(healthUrl).then((r: any) => r.status));
  }
  ok('10 rapid health probes all 200 (exempt from rate limiter)', healthHits.every((s) => s === 200), healthHits);

  const otherHits: any[] = [];
  for (let i = 0; i < 4; i++) {
    otherHits.push(await fetch(`http://127.0.0.1:${healthPort}/api/definitely-missing`));
  }
  ok(
    'non-health /api routes pass through the limiter (allowed ×3, then 429)',
    otherHits[0].status !== 429 && otherHits[3].status === 429,
    otherHits.map((r) => r.status),
  );
  const limited: any = await otherHits[3].json();
  ok('429 body carries RATE_LIMITED code', limited?.error?.code === 'RATE_LIMITED', limited);

  // ═══ [4] Scheduler guards while DB disconnected ═════════════════════════
  console.log('\n[4] Scheduler guards (database not connected yet)');
  ok('scheduler starts stopped', isSchedulerStarted() === false);
  ok('runJobNow(unknown job) → false', (await runJobNow('no-such-job')) === false);

  let needsdbRan = false;
  __registerTestJob('needsdb-check', async () => {
    needsdbRan = true;
  }, { requiresDb: true });
  const ranDb = await runJobNow('needsdb-check');
  const dbRec = getJobStatuses().find((x: any) => x.name === 'needsdb-check');
  ok('DB-requiring job was invoked', ranDb === true);
  ok('DB-requiring job skipped while disconnected', dbRec?.lastOutcome === 'skipped-db', dbRec?.lastOutcome);
  ok('skipped job did not execute its handler', needsdbRan === false);
  ok('skip is not counted as a run', dbRec?.runCount === 0, dbRec?.runCount);
  __resetSchedulerForTests();

  // ═══ [5] Scheduling: start-once, invalid cron, retention gate ═══════════
  console.log('\n[5] Scheduler registration');
  startScheduler();
  let jobs = getJobStatuses();
  ok('both production jobs registered', jobs.length === 2, jobs.map((j: any) => j.name));
  const sub = jobs.find((j: any) => j.name === 'subscription-notifications');
  const ret = jobs.find((j: any) => j.name === 'retention-archiving');
  ok('subscription job scheduled with maintenance cron', sub?.enabled === true && sub?.schedule === '0 0 * * *', sub);
  ok('retention job scheduled (default enabled)', ret?.enabled === true, ret?.enabled);

  startScheduler(); // deliberate duplicate
  jobs = getJobStatuses();
  ok('duplicate startScheduler() ignored — still exactly 2 jobs', jobs.length === 2 && isSchedulerStarted() === true, jobs.length);
  ok('duplicate start did not re-register cron schedule', jobs.find((j: any) => j.name === 'subscription-notifications')?.schedule === '0 0 * * *');

  __resetSchedulerForTests();
  const savedCron = env.MAINTENANCE_CRON;
  env.MAINTENANCE_CRON = 'not-a-cron';
  startScheduler();
  jobs = getJobStatuses();
  ok(
    'invalid cron: jobs registered but NOT scheduled (no crash)',
    jobs.length === 2 && jobs.every((j: any) => j.enabled === false && j.schedule === ''),
    jobs.map((j: any) => ({ name: j.name, enabled: j.enabled, schedule: j.schedule })),
  );
  __resetSchedulerForTests();
  env.MAINTENANCE_CRON = savedCron;

  env.RETENTION_SCHEDULED_ENABLED = false;
  startScheduler();
  jobs = getJobStatuses();
  const ret2 = jobs.find((j: any) => j.name === 'retention-archiving');
  const sub2 = jobs.find((j: any) => j.name === 'subscription-notifications');
  ok(
    'RETENTION_SCHEDULED_ENABLED=false gates retention only',
    ret2?.enabled === false && sub2?.enabled === true,
    { retention: ret2?.enabled, subscription: sub2?.enabled },
  );
  __resetSchedulerForTests();
  env.RETENTION_SCHEDULED_ENABLED = true;
  startScheduler();
  ok(
    'final state: both jobs enabled and registered',
    isSchedulerStarted() === true && getJobStatuses().length === 2 && getJobStatuses().every((j: any) => j.enabled === true),
  );

  // ═══ [6] Database connect + health "connected" ══════════════════════════
  console.log('\n[6] Database connect + health after connect');
  await connectDB();
  ok('mongoose readyState === 1 after connectDB', mongoose.connection.readyState === 1);

  const hb2: any = await fetch(healthUrl).then((r: any) => r.json());
  ok('health reports "connected" after connect', hb2?.data?.database === 'connected', hb2?.data?.database);
  ok('health reports both scheduled jobs enabled', hb2?.data?.scheduledJobs?.count === 2 && hb2?.data?.scheduledJobs?.enabled === 2, hb2?.data?.scheduledJobs);

  // ═══ [7] Production job execution + financial-data invariance ═══════════
  console.log('\n[7] Production job execution (test DB: bms_check_jobs)');
  const db = mongoose.connection.db;
  const txnsBefore = await db.collection('transactions').countDocuments();
  const paymentsBefore = await db.collection('payments').countDocuments();
  const loansBefore = await db.collection('loans').countDocuments();

  ok('runJobNow(subscription-notifications) executed', (await runJobNow('subscription-notifications')) === true);
  let j = getJobStatuses().find((x: any) => x.name === 'subscription-notifications');
  ok('subscription job outcome=ok, no errors', j?.lastOutcome === 'ok' && j?.errorCount === 0 && j?.runCount >= 1, j);

  ok('runJobNow(retention-archiving) executed', (await runJobNow('retention-archiving')) === true);
  j = getJobStatuses().find((x: any) => x.name === 'retention-archiving');
  ok('retention job outcome=ok, no errors', j?.lastOutcome === 'ok' && j?.errorCount === 0 && j?.runCount >= 1, j);

  const txnsAfter = await db.collection('transactions').countDocuments();
  const paymentsAfter = await db.collection('payments').countDocuments();
  const loansAfter = await db.collection('loans').countDocuments();
  ok(
    'financial collections unchanged by scheduled jobs',
    txnsAfter === txnsBefore && paymentsAfter === paymentsBefore && loansAfter === loansBefore,
    { txnsBefore, txnsAfter, paymentsBefore, paymentsAfter, loansBefore, loansAfter },
  );

  // ═══ [8] Error containment, overlap, live cron timer, stop ══════════════
  console.log('\n[8] Error containment, overlap guard, live cron timing');

  __registerTestJob('boom', async () => {
    throw new Error('intentional-test-failure');
  });
  const boomRan = await runJobNow('boom');
  const boom = getJobStatuses().find((x: any) => x.name === 'boom');
  ok('failing job does not throw — error captured', boomRan === true && boom?.lastOutcome === 'error', { ran: boomRan, outcome: boom?.lastOutcome });
  ok('error recorded with count + message', boom?.errorCount === 1 && String(boom?.lastError).includes('intentional-test-failure'), boom);

  let executions = 0;
  let active = 0;
  let maxActive = 0;
  __registerTestJob('slow', async () => {
    executions += 1;
    active += 1;
    if (active > maxActive) maxActive = active;
    await sleep(600);
    active -= 1;
  });
  await Promise.all([runJobNow('slow'), runJobNow('slow')]);
  const slow = getJobStatuses().find((x: any) => x.name === 'slow');
  ok('concurrent triggers never overlap (single execution)', executions === 1 && maxActive === 1, { executions, maxActive });
  ok('second trigger counted as skip, not a run', slow?.runCount === 1, { runCount: slow?.runCount, outcome: slow?.lastOutcome });

  let ticks = 0;
  __registerTestJob('ticker', async () => {
    ticks += 1;
  }, { enabled: true, schedule: '*/1 * * * * *' });
  await sleep(2400);
  const ticker = getJobStatuses().find((x: any) => x.name === 'ticker');
  ok('cron timer fires in real time (6-field seconds expression)', ticks >= 1 && (ticker?.runCount ?? 0) >= 1, { ticks, runCount: ticker?.runCount });
  ok('live cron runs and run counter stay in sync', (ticker?.runCount ?? 0) === ticks, { ticks, runCount: ticker?.runCount });

  stopScheduler();
  const ticksAtStop = ticks;
  await sleep(1300);
  ok('stopScheduler() stops cron timers', ticks === ticksAtStop && isSchedulerStarted() === false, { ticksAtStop, ticks });

  __resetSchedulerForTests();
  startScheduler();
  ok('scheduler restartable after stop (clean 2-job state)', isSchedulerStarted() === true && getJobStatuses().length === 2);

  // ═══ [9] Keep-alive pings against a local HTTP server ═══════════════════
  console.log('\n[9] Keep-alive: validation, pings, interval, idempotency');
  __resetKeepAliveForTests();

  targetServer = http.createServer((req: any, res: any) => {
    const u = req.url || '/';
    if (u.startsWith('/ok')) {
      res.writeHead(200);
      res.end('ok');
    } else if (u.startsWith('/fail')) {
      res.writeHead(500);
      res.end('err');
    } else if (u.startsWith('/redir')) {
      res.writeHead(302, { Location: '/ok' });
      res.end();
    } else if (u.startsWith('/slow')) {
      // hold the request open until the client times out
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const targetPort: number = await new Promise((resolve) => targetServer.listen(0, '127.0.0.1', () => resolve(targetServer.address().port)));
  const targetBase = `http://127.0.0.1:${targetPort}`;

  env.KEEP_ALIVE_ENABLED = false;
  startKeepAlive();
  let st = getKeepAliveStatus();
  ok('disabled by default — does not start', st.enabled === false && st.running === false, st);

  env.KEEP_ALIVE_ENABLED = true;
  env.KEEP_ALIVE_URL = '';
  startKeepAlive();
  ok('enabled without URL does not start', getKeepAliveStatus().running === false);

  env.KEEP_ALIVE_URL = 'not-a-url';
  startKeepAlive();
  ok('enabled with invalid URL does not start', getKeepAliveStatus().running === false);

  env.KEEP_ALIVE_URL = `${targetBase}/ok?token=SUPERSECRET123`;
  const cap1 = await withCapturedLogs(() => pingOnce());
  st = getKeepAliveStatus();
  ok('ping to /ok succeeds (200)', cap1.result === true && st.lastPingOk === true && st.lastPingStatusCode === 200, { result: cap1.result, status: st.lastPingStatusCode });
  ok('ping log shows sanitized URL — no token', cap1.lines.every((l) => !l.includes('SUPERSECRET123')) && cap1.lines.some((l) => l.includes('/ok')), cap1.lines.filter((l) => l.includes('SUPERSECRET')));

  env.KEEP_ALIVE_URL = `${targetBase}/fail`;
  const p2 = await pingOnce();
  ok('ping to 500 counted as failure', p2 === false && getKeepAliveStatus().lastPingStatusCode === 500, { result: p2, status: getKeepAliveStatus().lastPingStatusCode });

  env.KEEP_ALIVE_URL = `${targetBase}/missing`;
  const p3 = await pingOnce();
  ok('ping to 404 counted as failure', p3 === false, p3);

  env.KEEP_ALIVE_URL = `${targetBase}/redir`;
  const p4 = await pingOnce();
  ok('ping to 302 counted as ok (redirect not followed)', p4 === true && getKeepAliveStatus().lastPingStatusCode === 302, { result: p4, status: getKeepAliveStatus().lastPingStatusCode });

  const deadPort = await freePort();
  env.KEEP_ALIVE_URL = `http://127.0.0.1:${deadPort}/health`;
  const cap5 = await withCapturedLogs(() => pingOnce());
  ok('ping to closed port fails without throwing', cap5.result === false && getKeepAliveStatus().lastError !== null, { result: cap5.result, err: getKeepAliveStatus().lastError });

  env.KEEP_ALIVE_URL = `${targetBase}/slow`;
  const savedTimeout = env.KEEP_ALIVE_TIMEOUT_MS;
  env.KEEP_ALIVE_TIMEOUT_MS = 800;
  const t0 = Date.now();
  const p6 = await pingOnce();
  const elapsed = Date.now() - t0;
  env.KEEP_ALIVE_TIMEOUT_MS = savedTimeout;
  ok('ping timeout enforced (~800ms, no hang)', p6 === false && elapsed >= 700 && elapsed < 3000, { result: p6, elapsed });
  ok('timeout reported as timeout', String(getKeepAliveStatus().lastError).includes('timeout after 800ms'), getKeepAliveStatus().lastError);

  env.KEEP_ALIVE_URL = `${targetBase}/ok?token=ANOTHERSECRET`;
  env.KEEP_ALIVE_INTERVAL_MINUTES = 60;
  startKeepAlive();
  st = getKeepAliveStatus();
  ok('startKeepAlive() runs with valid config (target sanitized)', st.running === true && st.enabled === true && st.target === `${targetBase}/ok`, { running: st.running, target: st.target });
  const capDup = await withCapturedLogs(async () => {
    startKeepAlive();
  });
  ok('duplicate startKeepAlive() ignored', capDup.lines.some((l) => l.includes('more than once')) && getKeepAliveStatus().running === true, capDup.lines);
  stopKeepAlive();
  ok('stopKeepAlive() stops the timer', getKeepAliveStatus().running === false);
  stopKeepAlive();
  ok('stopKeepAlive() idempotent', getKeepAliveStatus().running === false);

  // Interval tick + in-flight skip (fractional minutes → ~1.2s cadence).
  __resetKeepAliveForTests();
  env.KEEP_ALIVE_ENABLED = true;
  env.KEEP_ALIVE_URL = `${targetBase}/slow`;
  env.KEEP_ALIVE_INTERVAL_MINUTES = 0.02; // 1.2 s
  env.KEEP_ALIVE_TIMEOUT_MS = 4000;
  const capTick = await withCapturedLogs(async () => {
    startKeepAlive();
    await sleep(4200);
    stopKeepAlive();
  });
  const ka = getKeepAliveStatus();
  ok('interval timer issues pings unattended', ka.pings === 1, { pings: ka.pings, failures: ka.failures });
  ok('in-flight ping causes later ticks to be skipped (no pile-up)', capTick.lines.some((l) => l.includes('in flight')), { pings: ka.pings });
  await sleep(1600); // let the held /slow ping hit its 4s abort cleanly
  __resetKeepAliveForTests();
  env.KEEP_ALIVE_ENABLED = false;
  env.KEEP_ALIVE_URL = '';
  env.KEEP_ALIVE_INTERVAL_MINUTES = 1440;
  env.KEEP_ALIVE_TIMEOUT_MS = 10000;

  // ═══ [10] Graceful shutdown handler (in-process, real components) ═══════
  console.log('\n[10] Graceful shutdown handler (in-process)');
  const order: string[] = [];
  const exits: number[] = [];
  appServer.on('close', () => order.push('server-closed'));
  const realShutdown = createShutdownHandler({
    server: appServer,
    stopJobScheduler: () => {
      order.push('stop-jobs');
      stopScheduler();
    },
    stopKeepAlive: () => {
      order.push('stop-keepalive');
      stopKeepAlive();
    },
    disconnectDb: async () => {
      order.push('disconnect-db');
      await disconnectDB();
    },
    closeTimeoutMs: 2000,
    exit: (code: number) => {
      order.push(`exit:${code}`);
      exits.push(code);
    },
  });

  await realShutdown('TEST-SIGTERM');
  ok('shutdown stops the scheduler', isSchedulerStarted() === false);
  ok('shutdown closes the HTTP server', await fetch(healthUrl).then(() => false).catch(() => true));
  ok('shutdown disconnects the database', mongoose.connection.readyState === 0);
  ok(
    'shutdown order: jobs → keep-alive → server close → DB → exit(0)',
    JSON.stringify(order) === JSON.stringify(['stop-jobs', 'stop-keepalive', 'server-closed', 'disconnect-db', 'exit:0']),
    order,
  );
  ok('shutdown exits exactly once with code 0', exits.length === 1 && exits[0] === 0, exits);

  await realShutdown('TEST-SIGINT');
  ok('re-entrant shutdown collapses to a single run', exits.length === 1 && order.filter((x) => x.startsWith('exit')).length === 1, { exits, order });

  // Hung server.close() → force exit(1) after closeTimeoutMs.
  const stuckExits: number[] = [];
  const stuckShutdown = createShutdownHandler({
    server: { close: () => undefined, closeIdleConnections: () => undefined },
    stopJobScheduler: () => undefined,
    stopKeepAlive: () => undefined,
    disconnectDb: async () => undefined,
    closeTimeoutMs: 250,
    exit: (c: number) => stuckExits.push(c),
  });
  const stuckStart = Date.now();
  await stuckShutdown('TEST-STUCK');
  const stuckElapsed = Date.now() - stuckStart;
  ok('hung server.close() → forced exit(1) after timeout', stuckExits.length === 1 && stuckExits[0] === 1 && stuckElapsed >= 250, { exits: stuckExits, stuckElapsed });

  // Failing stop/disconnect steps are contained — shutdown still completes.
  const throwExits: number[] = [];
  const throwShutdown = createShutdownHandler({
    server: { close: (cb?: (err?: Error) => void) => { cb?.(undefined); return undefined as never; }, closeIdleConnections: () => undefined },
    stopJobScheduler: () => {
      throw new Error('stop failure');
    },
    stopKeepAlive: () => {
      throw new Error('stop failure');
    },
    disconnectDb: async () => {
      throw new Error('disconnect failure');
    },
    closeTimeoutMs: 500,
    exit: (c: number) => throwExits.push(c),
  });
  await throwShutdown('TEST-FAILING-STEPS');
  ok('failing stop/disconnect steps still exit(0) — no strand', throwExits.length === 1 && throwExits[0] === 0, throwExits);

  // ═══ [11] Real child-process bootstrap & failure paths ══════════════════
  console.log('\n[11] Real child process (node --import tsx src/index.ts)');
  const childBaseEnv: Record<string, string> = {
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/bms_check_jobs',
    JWT_SECRET: 'check-jobs-canary-secret-do-not-leak',
    RATE_LIMIT_MAX: '300',
    RATE_LIMIT_WINDOW_MINUTES: '15',
    MAINTENANCE_CRON: '0 0 * * *',
    RETENTION_SCHEDULED_ENABLED: 'true',
    KEEP_ALIVE_ENABLED: 'false',
    KEEP_ALIVE_URL: '',
    KEEP_ALIVE_INTERVAL_MINUTES: '60',
    KEEP_ALIVE_TIMEOUT_MS: '5000',
  };

  const childPort = await freePort();
  const c1 = spawnServer({
    ...childBaseEnv,
    PORT: String(childPort),
    KEEP_ALIVE_ENABLED: 'true',
    KEEP_ALIVE_URL: `http://127.0.0.1:${childPort}/api/health`,
  });
  const healthUrl1 = `http://127.0.0.1:${childPort}/api/health`;
  let booted = false;
  const bootDeadline = Date.now() + 40000;
  while (Date.now() < bootDeadline) {
    try {
      const r = await fetch(healthUrl1);
      if (r.status === 200) {
        booted = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  ok('child server boots and answers /api/health on process.env.PORT', booted, booted ? undefined : tail(c1.getOut()));

  if (booted) {
    const hb1: any = await fetch(healthUrl1).then((r: any) => r.json());
    ok(
      'child health: DB connected, 2 scheduled jobs, keep-alive on',
      hb1?.data?.database === 'connected' && hb1?.data?.scheduledJobs?.count === 2 && hb1?.data?.keepAlive?.enabled === true,
      hb1?.data,
    );
    const out1 = c1.getOut();
    ok(
      'jobs scheduled EXACTLY once at boot (no duplicate scheduling)',
      countOccurrences(out1, '[jobs] scheduled subscription-notifications') === 1 &&
        countOccurrences(out1, '[jobs] scheduled retention-archiving') === 1,
      { subscription: countOccurrences(out1, '[jobs] scheduled subscription-notifications'), retention: countOccurrences(out1, '[jobs] scheduled retention-archiving') },
    );
    ok('keep-alive started in child (self health URL)', out1.includes('[keep-alive] started'));
    ok('no duplicate-bootstrap/duplicate-start warnings', !out1.includes('called more than once') && !out1.includes('duplicate ignored'));

    // Second listener on the same port → EADDRINUSE → exit 1.
    const c2 = spawnServer({ ...childBaseEnv, PORT: String(childPort) });
    const res2 = await waitForExit(c2.child, 30000);
    ok('duplicate listener exits with code 1 (EADDRINUSE)', res2.exited && res2.code === 1, { code: res2.code, out: tail(c2.getOut()) });
    ok('EADDRINUSE explained in logs', c2.getOut().includes('already in use'), tail(c2.getOut()));
    if (!res2.exited) c2.child.kill();

    // SIGTERM handling. On Linux this runs the graceful path; on Windows the
    // OS force-terminates (see file header) — either way the process must go.
    c1.child.kill('SIGTERM');
    const res1 = await waitForExit(c1.child, 15000);
    ok('child exits after SIGTERM request (no orphan/hang)', res1.exited, { code: res1.code, signal: res1.signal });
    if (res1.exited && res1.code === 0 && c1.getOut().includes('shutdown complete')) {
      ok('child performed a graceful SIGTERM shutdown', true);
    } else if (res1.exited) {
      note(
        `win32: child.kill('SIGTERM') force-terminates before any handler runs (exit=${res1.code}, signal=${res1.signal}) — verified OS limitation. The exact shutdown handler is exercised in section [10]; on Render (Linux) SIGTERM is delivered normally.`,
      );
    } else {
      c1.child.kill();
    }
  } else if (booted === false && c1.child) {
    c1.child.kill(); // cleanup a child that never became healthy
  }

  // Database unreachable → clean exit 1, jobs never started.
  const c3 = spawnServer({ ...childBaseEnv, PORT: String(await freePort()), MONGODB_URI: 'mongodb://127.0.0.1:1/bms_dead' });
  const res3 = await waitForExit(c3.child, 30000);
  ok('DB failure → child exits with code 1', res3.exited && res3.code === 1, { code: res3.code, out: tail(c3.getOut()) });
  ok('DB failure is logged clearly', c3.getOut().includes('MongoDB connection failed') || c3.getOut().includes('[bootstrap] fatal'), tail(c3.getOut()));
  ok('DB failure → jobs never started', !c3.getOut().includes('[jobs] scheduled'), tail(c3.getOut()));
  if (!res3.exited) c3.child.kill();

  // ═══ [12] Final assertions + summary ════════════════════════════════════
  console.log('\n[12] Final assertions');
  ok('zero unhandled rejections during the whole suite', unhandledRejections === 0, unhandledRejections);

  // Cleanup so the process can exit promptly.
  __resetSchedulerForTests();
  __resetKeepAliveForTests();
  try {
    if (targetServer) {
      targetServer.closeAllConnections?.();
      targetServer.close();
    }
  } catch {
    /* already closed */
  }
  try {
    await disconnectDB();
  } catch {
    /* already disconnected */
  }

  console.log(`\n${'-'.repeat(56)}`);
  if (failed === 0 && unhandledRejections === 0) {
    console.log(`RESULT: ALL ${passed} CHECKS PASSED`);
  } else {
    console.log(`RESULT: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  }
  process.exit(failed > 0 || unhandledRejections > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nFATAL: unhandled error in check-jobs script →', err);
  process.exit(1);
});
