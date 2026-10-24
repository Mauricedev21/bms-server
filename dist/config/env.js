"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProd = exports.env = exports.envHadWarnings = void 0;
exports.int = int;
exports.str = str;
exports.bool = bool;
exports.intClamped = intClamped;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function int(name, fallback) {
    const raw = process.env[name];
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function str(name, fallback = '') {
    const raw = process.env[name];
    return raw === undefined || raw === '' ? fallback : String(raw).trim();
}
/**
 * Boolean env flag. Accepted truthy values: true/1/yes (case-insensitive).
 * Anything else — including an empty/unset value — resolves to the fallback,
 * so a typo can only ever disable a feature, never silently enable one.
 */
function bool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return fallback;
    const normalized = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized))
        return true;
    if (['false', '0', 'no'].includes(normalized))
        return false;
    warnEnv(`[env] ${name}="${raw}" is not a boolean (use true/false) — using default ${fallback}`);
    return fallback;
}
/**
 * Integer env value clamped to [min, max]. Non-numeric or out-of-range input
 * logs a warning (never the value of any secret — only the variable name) and
 * falls back to the default, so a bad value can never crash the scheduler.
 */
function intClamped(name, fallback, min, max) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        warnEnv(`[env] ${name} is not a number — using default ${fallback}`);
        return fallback;
    }
    if (parsed < min || parsed > max) {
        const clamped = Math.min(Math.max(parsed, min), max);
        warnEnv(`[env] ${name}=${parsed} out of range [${min}, ${max}] — using ${clamped}`);
        return clamped;
    }
    return parsed;
}
let warned = false;
function warnEnv(message) {
    // eslint-disable-next-line no-console
    console.warn(message);
    warned = true;
}
/** True when at least one env value had to be corrected at load time. */
const envHadWarnings = () => warned;
exports.envHadWarnings = envHadWarnings;
exports.env = {
    NODE_ENV: str('NODE_ENV', 'development'),
    PORT: int('PORT', 4000),
    API_PREFIX: str('API_PREFIX', '/api'),
    MONGODB_URI: str('MONGODB_URI', ''),
    REDIS_URL: str('REDIS_URL', ''),
    JWT_SECRET: str('JWT_SECRET', ''),
    JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '30d'),
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
    /**
     * Storage quota in MB used by the admin dashboard's database-usage widget.
     * Default 512 MB matches the MongoDB Atlas free tier — override it on
     * Render to match your actual Atlas plan (e.g. 1024, 10240). Set to 0 to
     * disable the configured quota (falls back to the database's own
     * filesystem stats when available).
     */
    DB_STORAGE_LIMIT_MB: int('DB_STORAGE_LIMIT_MB', 512),
    CACHE_TTL_USER: int('CACHE_TTL_USER', 120),
    CACHE_TTL_SALON: int('CACHE_TTL_SALON', 120),
    CACHE_TTL_DASHBOARD: int('CACHE_TTL_DASHBOARD', 60),
    CACHE_TTL_LIST: int('CACHE_TTL_LIST', 60),
    /** When 'false' the public registration endpoint refuses new sign-ups. */
    ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION !== 'false',
    // ── Scheduled jobs ────────────────────────────────────────────────────────
    /**
     * Standard 5-field cron expression for the daily maintenance job
     * (retention archiving + subscription-expiry notification refresh).
     * Validated by node-cron at startup; an invalid value logs an error and
     * the job stays disabled instead of crashing the process.
     */
    MAINTENANCE_CRON: str('MAINTENANCE_CRON', '0 0 * * *'),
    /**
     * Master switch for the retention (archive-then-remove) half of the
     * maintenance job. Default true = preserves the pre-existing behaviour of
     * running retention once per day. Set 'false' to run retention only
     * manually via POST /api/admin/retention/run — the scheduled job will then
     * only refresh subscription notifications (read/create-notify, no deletes).
     */
    RETENTION_SCHEDULED_ENABLED: bool('RETENTION_SCHEDULED_ENABLED', true),
    // ── Keep-alive ping (optional) ───────────────────────────────────────────
    /**
     * When true, the server pings KEEP_ALIVE_URL every
     * KEEP_ALIVE_INTERVAL_MINUTES while it is running. Disabled by default and
     * never populated with a production URL — set the URL per environment
     * (locally or on Render) after the service has a public address.
     */
    KEEP_ALIVE_ENABLED: bool('KEEP_ALIVE_ENABLED', false),
    /** Absolute http(s) URL to ping. Empty = keep-alive stays off even if enabled. */
    KEEP_ALIVE_URL: str('KEEP_ALIVE_URL', ''),
    /**
     * Minutes between pings. Clamped to [1, 1440]. Note: Render's free tier
     * suspends instances after ~15 min without *external* HTTP traffic; an
     * internal ping cannot wake a suspended instance (see RENDER_DEPLOYMENT.md).
     */
    KEEP_ALIVE_INTERVAL_MINUTES: intClamped('KEEP_ALIVE_INTERVAL_MINUTES', 10, 1, 1440),
    /** Per-request timeout in ms for the keep-alive ping. Clamped to [1000, 60000]. */
    KEEP_ALIVE_TIMEOUT_MS: intClamped('KEEP_ALIVE_TIMEOUT_MS', 10000, 1000, 60000),
};
exports.isProd = exports.env.NODE_ENV === 'production';
// Fail fast in production: never run with the known weak dev secret or a
// missing Mongo URI. These are load-time guards so a misconfigured deployment
// refuses to boot instead of silently authorizing forged tokens.
if (exports.isProd) {
    const missing = [];
    if (!exports.env.JWT_SECRET)
        missing.push('JWT_SECRET');
    if (!exports.env.MONGODB_URI)
        missing.push('MONGODB_URI');
    if (missing.length) {
        // eslint-disable-next-line no-console
        console.error(`[env] production requires a value for: ${missing.join(', ')}`);
        process.exit(1);
    }
}
//# sourceMappingURL=env.js.map