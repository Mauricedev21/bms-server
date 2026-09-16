"use strict";
/**
 * Money & commission helper.
 *
 * RWF (Rwandan Francs) is treated as a whole-franc unit. All arithmetic is done
 * with integer math (francs) to avoid floating-point errors. The commission split
 * always preserves the invariant:
 *
 *   managerShare + barberShare === totalAmount
 *
 * This helper is the ONLY place where the 60/40 (configurable) split is computed,
 * and it runs exclusively on the backend so the frontend can never manipulate it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENCY = void 0;
exports.toCents = toCents;
exports.fromCents = fromCents;
exports.isValidAmount = isValidAmount;
exports.normalizeAmount = normalizeAmount;
exports.calculateShare = calculateShare;
exports.formatRWF = formatRWF;
const env_1 = require("../config/env");
function toCents(amount) {
    return Math.round(amount * 100);
}
function fromCents(cents) {
    return cents / 100;
}
/** Validate a monetary amount: finite, >= 0, at most 2 decimals. */
function isValidAmount(amount) {
    if (typeof amount !== 'number' || !Number.isFinite(amount))
        return false;
    if (amount < 0)
        return false;
    const cents = toCents(amount);
    return Math.abs(cents - amount * 100) < 1e-6;
}
/** Normalize an amount to exactly 2-decimal precision (as cents-based number). */
function normalizeAmount(amount) {
    return fromCents(toCents(amount));
}
/**
 * Compute the 60/40 (configurable) split for a total transaction amount.
 * round-half-up on the manager share; barber share keeps the exact remainder so
 * that managerShare + barberShare always equals the original total.
 */
function calculateShare(total, managerPercent = env_1.env.MANAGER_SHARE_PERCENT, barberPercent = env_1.env.BARBER_SHARE_PERCENT) {
    if (!isValidAmount(total)) {
        throw new Error('Invalid amount for share calculation');
    }
    if (!Number.isInteger(managerPercent) || !Number.isInteger(barberPercent)) {
        throw new Error('Percentages must be integers');
    }
    if (managerPercent + barberPercent !== 100) {
        throw new Error('Percentages must sum to 100');
    }
    const managerShare = Math.round(toCents((total * managerPercent) / 100) / 100 * 100) / 100;
    const barberShare = Math.round(toCents(total - managerShare) / 100 * 100) / 100;
    return {
        total,
        managerShare,
        barberShare,
        managerPercent,
        barberPercent,
    };
}
/** Format a number as RWF currency string. */
function formatRWF(amount) {
    return `${env_1.env.CURRENCY} ${new Intl.NumberFormat('en-RW', { maximumFractionDigits: 2 }).format(amount)}`;
}
exports.CURRENCY = env_1.env.CURRENCY;
//# sourceMappingURL=money.js.map