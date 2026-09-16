"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authLimiter = exports.apiLimiter = void 0;
exports.checkLoginAttempts = checkLoginAttempts;
exports.recordLoginAttempt = recordLoginAttempt;
exports.clearLoginAttempts = clearLoginAttempts;
const express_rate_limit_1 = require("express-rate-limit");
const env_1 = require("../config/env");
const AppError_1 = require("../utils/AppError");
exports.apiLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: env_1.env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    max: env_1.env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
    },
});
/** Legacy IP-based limiter kept for non-login auth routes (register, etc.). */
exports.authLimiter = (0, express_rate_limit_1.rateLimit)({
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
const loginAttempts = new Map();
function getEntry(key) {
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
function checkLoginAttempts(identifier) {
    const key = identifier.trim().toLowerCase();
    const entry = getEntry(key);
    if (entry.count >= MAX_LOGIN_ATTEMPTS) {
        const retryAfterMs = entry.windowStart + LOGIN_WINDOW_MS - Date.now();
        const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
        throw new AppError_1.AppError(429, `Too many login attempts for this account. Try again in ${retryAfter} seconds.`, 'RATE_LIMITED', { retryAfter, maxAttempts: MAX_LOGIN_ATTEMPTS, windowSeconds: LOGIN_WINDOW_MS / 1000 });
    }
}
/** Record one failed attempt. */
function recordLoginAttempt(identifier) {
    const key = identifier.trim().toLowerCase();
    const entry = getEntry(key);
    entry.count++;
    loginAttempts.set(key, entry);
}
/** Clear attempts on successful login. */
function clearLoginAttempts(identifier) {
    loginAttempts.delete(identifier.trim().toLowerCase());
}
//# sourceMappingURL=rateLimiter.js.map