"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
exports.ensureSubscriptionNotification = ensureSubscriptionNotification;
exports.refreshAllSubscriptionNotifications = refreshAllSubscriptionNotifications;
const Notification_1 = require("../models/Notification");
const User_1 = require("../models/User");
const logger_1 = require("../utils/logger");
const env_1 = require("../config/env");
async function notify(input) {
    await Notification_1.Notification.create({
        user: input.userId,
        type: input.type ?? 'system',
        title: input.title,
        message: input.message ?? '',
        data: input.data ?? {},
    });
}
/**
 * Ensures a manager account has an up-to-date expiry/expired notification.
 * Idempotent: won't create a duplicate while an unresolved notification of the
 * same type exists for this user.
 */
async function ensureSubscriptionNotification(userId) {
    try {
        const user = await User_1.User.findById(userId).lean();
        if (!user || user.role !== 'manager')
            return;
        const now = new Date();
        const end = user.subscriptionEnd ? new Date(user.subscriptionEnd).getTime() : now.getTime();
        const daysLeft = Math.max(0, Math.ceil((end - now.getTime()) / (24 * 60 * 60 * 1000)));
        const type = now.getTime() > end ? 'account_expired' : daysLeft <= env_1.env.NOTIFICATION_EXPIRY_DAYS ? 'account_expiring' : null;
        if (!type)
            return;
        const existing = await Notification_1.Notification.findOne({ user: userId, type, read: false }).lean();
        if (existing)
            return;
        const title = type === 'account_expired'
            ? 'Subscription expired'
            : `Subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
        const message = type === 'account_expired'
            ? `Your ${env_1.env.ACCOUNT_PERIOD_DAYS}-day subscription period has ended. Contact support to renew your account.`
            : `Your subscription period ends on ${new Date(end).toDateString()}. Renew to keep your salon active.`;
        await Notification_1.Notification.create({
            user: userId,
            type,
            title,
            message,
            data: { daysLeft, subscriptionEnd: new Date(end).toISOString() },
        });
    }
    catch (err) {
        logger_1.logger.warn('[notifications] ensureSubscriptionNotification failed', err.message);
    }
}
/** Refresh account-status notifications for every manager. */
async function refreshAllSubscriptionNotifications() {
    const managers = await User_1.User.find({ role: 'manager' }).select('_id').lean();
    for (const m of managers) {
        await ensureSubscriptionNotification(String(m._id));
    }
    return managers.length;
}
//# sourceMappingURL=notification.service.js.map