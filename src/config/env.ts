import dotenv from 'dotenv';

dotenv.config();

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : String(raw).trim();
}

export const env = {
  NODE_ENV: str('NODE_ENV', 'development'),
  PORT: int('PORT', 4000),
  API_PREFIX: str('API_PREFIX', '/api'),
  MONGODB_URI: str('MONGODB_URI', ''),
  REDIS_URL: str('REDIS_URL', ''),
  JWT_SECRET: str('JWT_SECRET', ''),
  JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '30d') as unknown as string,
  CLIENT_ORIGIN: str('CLIENT_ORIGIN', 'http://localhost:5173'),
  BCRYPT_ROUNDS: int('BCRYPT_ROUNDS', 10),
  RATE_LIMIT_WINDOW_MINUTES: int('RATE_LIMIT_WINDOW_MINUTES', 15),
  RATE_LIMIT_MAX: int('RATE_LIMIT_MAX', 300),
  MANAGER_SHARE_PERCENT: int('MANAGER_SHARE_PERCENT', 60),
  BARBER_SHARE_PERCENT: int('BARBER_SHARE_PERCENT', 40),
  CURRENCY: str('CURRENCY', 'RWF'),
  ACCOUNT_PERIOD_DAYS: int('ACCOUNT_PERIOD_DAYS', 30),
  NOTIFICATION_EXPIRY_DAYS: int('NOTIFICATION_EXPIRY_DAYS', 7),
  RETENTION_MONTHS: int('RETENTION_MONTHS', 6),
  CACHE_TTL_USER: int('CACHE_TTL_USER', 120),
  CACHE_TTL_SALON: int('CACHE_TTL_SALON', 120),
  CACHE_TTL_DASHBOARD: int('CACHE_TTL_DASHBOARD', 60),
  CACHE_TTL_LIST: int('CACHE_TTL_LIST', 60),
  /** When 'false' the public registration endpoint refuses new sign-ups. */
  ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION !== 'false',
};

export const isProd = env.NODE_ENV === 'production';

// Fail fast in production: never run with the known weak dev secret or a
// missing Mongo URI. These are load-time guards so a misconfigured deployment
// refuses to boot instead of silently authorizing forged tokens.
if (isProd) {
  const missing: string[] = [];
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.MONGODB_URI) missing.push('MONGODB_URI');
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`[env] production requires a value for: ${missing.join(', ')}`);
    process.exit(1);
  }
}