import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Optional HTTP keep-alive pinger.
 *
 * While the process is running it periodically issues a GET to
 * KEEP_ALIVE_URL (intended to be this service's own /api/health endpoint).
 *
 * Important limitation — documented here, in .env.example and in
 * RENDER_DEPLOYMENT.md: an internal ping can only generate traffic while the
 * instance is awake. It CANNOT wake a Render instance after Render has
 * suspended it, and it does not guarantee the service will never sleep.
 * Preventing sleep on free tiers requires an INDEPENDENT external scheduler /
 * uptime monitor hitting the public health URL from outside.
 *
 * Safety properties:
 *  - Disabled by default; a URL must be explicitly configured per environment
 *    (no hardcoded production URL).
 *  - URL is validated (http/https, parseable) before the first ping; an
 *    invalid configuration disables keep-alive instead of throwing.
 *  - Every request has a hard timeout (KEEP_ALIVE_TIMEOUT_MS).
 *  - Logs never include the query string of the URL (it may carry a token)
 *    and never any other secret; failures are logged as sanitized messages.
 *  - Overlapping pings are impossible: if a ping is still in flight when the
 *    next tick fires, the tick is skipped.
 */

export interface KeepAliveStatus {
  enabled: boolean;
  /** URL with query string stripped — safe to log/expose. */
  target: string | null;
  intervalMinutes: number;
  timeoutMs: number;
  running: boolean;
  pings: number;
  failures: number;
  lastPingAt: string | null;
  lastPingOk: boolean | null;
  lastPingStatusCode: number | null;
  lastError: string | null;
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let active = false;

const status: KeepAliveStatus = {
  enabled: false,
  target: null,
  intervalMinutes: env.KEEP_ALIVE_INTERVAL_MINUTES,
  timeoutMs: env.KEEP_ALIVE_TIMEOUT_MS,
  running: false,
  pings: 0,
  failures: 0,
  lastPingAt: null,
  lastPingOk: null,
  lastPingStatusCode: null,
  lastError: null,
};

/**
 * Remove user-info and query/fragment from a URL so it can be logged safely.
 * Returns null when the URL cannot be parsed.
 */
export function sanitizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export interface UrlValidation {
  valid: boolean;
  reason?: string;
}

/** Validate that a keep-alive target is an absolute http(s) URL. */
export function validateKeepAliveUrl(raw: string): UrlValidation {
  if (!raw.trim()) return { valid: false, reason: 'URL is empty' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, reason: 'URL is not parseable' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `unsupported protocol "${parsed.protocol}" (use http/https)` };
  }
  if (!parsed.hostname) return { valid: false, reason: 'URL has no host' };
  return { valid: true };
}

/** Single ping. Exported for tests; safe to call regardless of enablement. */
export async function pingOnce(): Promise<boolean> {
  const rawUrl = env.KEEP_ALIVE_URL;
  const sanitized = sanitizeUrl(rawUrl) ?? '(invalid-url)';
  const startedAt = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.KEEP_ALIVE_TIMEOUT_MS);

  status.pings += 1;
  status.lastPingAt = new Date().toISOString();

  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'bms-keep-alive/1.0' },
      redirect: 'manual',
    });
    const ok = response.status >= 200 && response.status < 400;
    status.lastPingOk = ok;
    status.lastPingStatusCode = response.status;
    status.lastError = ok ? null : `HTTP ${response.status}`;
    if (!ok) status.failures += 1;
    logger.info(
      `[keep-alive] GET ${sanitized} → ${response.status} in ${Date.now() - startedAt}ms${ok ? '' : ' (non-2xx)'}`,
    );
    return ok;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const aborted = name === 'AbortError' || (err instanceof Error && err.name === 'AbortError');
    const message = aborted
      ? `timeout after ${env.KEEP_ALIVE_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    status.lastPingOk = false;
    status.lastPingStatusCode = null;
    status.lastError = message;
    status.failures += 1;
    // Log the sanitized URL and the message only — never headers or config.
    logger.warn(`[keep-alive] GET ${sanitized} failed: ${message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate configuration and start the interval timer.
 * Idempotent: a second call while running logs and returns.
 * Any validation problem disables keep-alive (warn + off), never throws.
 */
export function startKeepAlive(): void {
  if (active) {
    logger.warn('[keep-alive] startKeepAlive() called more than once — ignored');
    return;
  }
  status.intervalMinutes = env.KEEP_ALIVE_INTERVAL_MINUTES;
  status.timeoutMs = env.KEEP_ALIVE_TIMEOUT_MS;

  if (!env.KEEP_ALIVE_ENABLED) {
    logger.info('[keep-alive] disabled (KEEP_ALIVE_ENABLED=false)');
    return;
  }

  const validation = validateKeepAliveUrl(env.KEEP_ALIVE_URL);
  if (!validation.valid) {
    logger.warn(
      `[keep-alive] enabled but misconfigured (${validation.reason}) — keep-alive will not start`,
    );
    status.enabled = false;
    status.target = null;
    return;
  }

  status.enabled = true;
  status.target = sanitizeUrl(env.KEEP_ALIVE_URL);
  status.running = true;
  active = true;

  timer = setInterval(() => {
    if (inFlight) {
      logger.warn('[keep-alive] previous ping still in flight — tick skipped');
      return;
    }
    inFlight = true;
    void pingOnce().finally(() => {
      inFlight = false;
    });
  }, env.KEEP_ALIVE_INTERVAL_MINUTES * 60_000);

  // Never hold the event loop open just for keep-alive ticks.
  timer.unref?.();
  logger.info(
    `[keep-alive] started: GET ${status.target} every ${env.KEEP_ALIVE_INTERVAL_MINUTES}m (timeout ${env.KEEP_ALIVE_TIMEOUT_MS}ms)`,
  );
}

/** Stop the interval timer. Idempotent. */
export function stopKeepAlive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  active = false;
  status.running = false;
}

export function getKeepAliveStatus(): KeepAliveStatus {
  return { ...status };
}

/** Test-only: clear all module state. */
export function __resetKeepAliveForTests(): void {
  stopKeepAlive();
  status.enabled = false;
  status.target = null;
  status.pings = 0;
  status.failures = 0;
  status.lastPingAt = null;
  status.lastPingOk = null;
  status.lastPingStatusCode = null;
  status.lastError = null;
}
