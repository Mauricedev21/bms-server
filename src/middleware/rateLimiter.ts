import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
  },
});

/** Legacy IP-based limiter kept for non-login auth routes (register, etc.). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts, please try again later.' },
  },
});

// ── Per-identifier login attempt limiter (5 attempts / 30 s window) ─────────

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 30_000;

const loginAttempts = new Map<string, { count: number; windowStart: number }>();

function getEntry(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.windowStart + LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 0, windowStart: now });
    return { count: 0, windowStart: now };
  }
  return entry;
}

/**
 * Throws 429 if the identifier has been tried too many times.
 * Call BEFORE the actual authentication attempt.
 */
export function checkLoginAttempts(identifier: string): void {
  const key = identifier.trim().toLowerCase();
  const entry = getEntry(key);
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    const retryAfterMs = entry.windowStart + LOGIN_WINDOW_MS - Date.now();
    const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
    throw new AppError(
      429,
      `Too many login attempts for this account. Try again in ${retryAfter} seconds.`,
      'RATE_LIMITED',
      { retryAfter, maxAttempts: MAX_LOGIN_ATTEMPTS, windowSeconds: LOGIN_WINDOW_MS / 1000 },
    );
  }
}

/** Record one failed attempt. */
export function recordLoginAttempt(identifier: string): void {
  const key = identifier.trim().toLowerCase();
  const entry = getEntry(key);
  entry.count++;
  loginAttempts.set(key, entry);
}

/** Clear attempts on successful login. */
export function clearLoginAttempts(identifier: string): void {
  loginAttempts.delete(identifier.trim().toLowerCase());
}