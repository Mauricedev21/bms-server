"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProd = exports.env = void 0;
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