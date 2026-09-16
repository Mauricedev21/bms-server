"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recentActivity = exports.refreshNotifications = exports.runRetention = exports.renewUser = exports.updateUserStatus = exports.createManager = exports.listUsers = exports.dashboard = void 0;
exports.subscriptionBucket = subscriptionBucket;
const asyncHandler_1 = require("../utils/asyncHandler");
const User_1 = require("../models/User");
const Salon_1 = require("../models/Salon");
const Notification_1 = require("../models/Notification");
const Transaction_1 = require("../models/Transaction");
const Barber_1 = require("../models/Barber");
const Loan_1 = require("../models/Loan");
const env_1 = require("../config/env");
const cacheService_1 = require("../cache/cacheService");
const AppError_1 = require("../utils/AppError");
const AuditLog_1 = require("../models/AuditLog");
const notification_service_1 = require("../services/notification.service");
const retention_service_1 = require("../services/retention.service");
function subscriptionBucket(user) {
    if (user.status === 'suspended')
        return 'suspended';
    if (!user.subscriptionEnd)
        return 'active';
    const now = Date.now();
    const end = new Date(user.subscriptionEnd).getTime();
    if (end < now)
        return 'expired';
    const daysLeft = Math.ceil((end - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= env_1.env.NOTIFICATION_EXPIRY_DAYS)
        return 'expiring';
    return 'active';
}
exports.dashboard = (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const admins = await User_1.User.find({ role: 'admin' }).select('_id').lean();
    const adminIds = admins.map((a) => a._id);
    const managers = await User_1.User.find({ role: 'manager' }).lean();
    const counts = { total: 0, active: 0, expiring: 0, expired: 0, suspended: 0 };
    for (const m of managers) {
        counts.total++;
        const b = subscriptionBucket(m);
        counts[b]++;
    }
    const [barberCount, txnCount, loanCount, activeLoanCount, recentRegistrations, notifications] = await Promise.all([
        Barber_1.Barber.countDocuments(),
        Transaction_1.Transaction.countDocuments({ status: 'completed' }),
        Loan_1.Loan.countDocuments(),
        Loan_1.Loan.countDocuments({ status: 'active' }),
        User_1.User.find({ role: 'manager' }).sort({ createdAt: -1 }).limit(8).select('username fullName phone email salon createdAt status subscriptionEnd lastActiveAt').lean(),
        Notification_1.Notification.find({ user: { $in: adminIds } }).sort({ createdAt: -1 }).limit(30).lean(),
    ]);
    const salonsById = new Map();
    const salons = await Salon_1.Salon.find({}).select('name').lean();
    for (const s of salons)
        salonsById.set(String(s._id), s);
    const recentWithSalons = recentRegistrations.map((u) => ({
        user: u,
        salonName: u.salon ? (salonsById.get(String(u.salon))?.name ?? '—') : '—',
    }));
    res.json({
        success: true,
        data: {
            counts,
            barberCount,
            totalTransactions: txnCount,
            totalLoans: loanCount,
            activeLoans: activeLoanCount,
            recentRegistrations: recentWithSalons,
            notifications,
        },
    });
});
exports.listUsers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const status = req.query.status;
    const search = req.query.search;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw AppError_1.AppError.badRequest('Invalid pagination values.');
    }
    const query = { role: 'manager' };
    if (status)
        query.status = status;
    if (search) {
        query.$or = [
            { username: { $regex: search, $options: 'i' } },
            { fullName: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ];
    }
    const [users, total, salons] = await Promise.all([
        User_1.User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        User_1.User.countDocuments(query),
        Salon_1.Salon.find({}).select('name city status').lean(),
    ]);
    const salonMap = new Map(salons.map((s) => [String(s._id), s]));
    const items = users.map((u) => ({
        _id: u._id,
        username: u.username,
        fullName: u.fullName,
        phone: u.phone,
        email: u.email,
        status: u.status,
        bucket: subscriptionBucket(u),
        registrationDate: u.createdAt,
        subscriptionStart: u.subscriptionStart,
        subscriptionEnd: u.subscriptionEnd,
        periodDays: u.periodDays,
        lastActiveAt: u.lastActiveAt,
        salon: u.salon ? salonMap.get(String(u.salon)) ?? null : null,
    }));
    res.json({ success: true, data: { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) } });
});
/** Admin provisions a manager account (with its own salon) on the platform. */
exports.createManager = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { username: rawUsername, fullName, phone, email, password, salonName } = req.body;
    const username = String(rawUsername).trim().toLowerCase();
    const existing = await User_1.User.findOne({ $or: [{ username }, { phone }, { email }] }).select('username phone email').lean();
    if (existing) {
        const field = existing.username === username ? 'username'
            : existing.phone === phone ? 'phone'
                : 'email';
        throw AppError_1.AppError.conflict(`A user already exists with this ${field}.`, { field });
    }
    const user = await User_1.User.create({
        username,
        fullName: fullName ?? '',
        phone,
        email,
        passwordHash: password,
        role: 'manager',
        status: 'active',
    });
    const salon = await Salon_1.Salon.create({
        owner: user._id,
        name: salonName,
        managerSharePercent: env_1.env.MANAGER_SHARE_PERCENT,
        barberSharePercent: env_1.env.BARBER_SHARE_PERCENT,
        currency: env_1.env.CURRENCY,
        status: 'active',
    });
    user.salon = salon._id;
    await user.save();
    await (0, notification_service_1.notify)({
        userId: String(user._id),
        type: 'account_activated',
        title: 'Salon account created',
        message: `Your salon "${salonName}" has been registered by the administrator. Sign in with your email and password.`,
        data: { salonId: String(salon._id) },
    });
    await AuditLog_1.AuditLog.create({
        actor: req.reqUser?._id,
        actorRole: 'admin',
        action: 'admin.manager_created',
        entity: 'User',
        entityId: user._id,
        after: { username, fullName, phone, email, salonName },
    });
    res.status(201).json({
        success: true,
        data: {
            user: { _id: user._id, username: user.username, fullName: user.fullName, phone: user.phone, email: user.email, role: 'manager', status: user.status },
            salon: { _id: salon._id, name: salon.name },
        },
    });
});
exports.updateUserStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.params.id;
    const status = req.body.status;
    const user = await User_1.User.findById(uid);
    if (!user)
        throw AppError_1.AppError.notFound('User not found.');
    if (user.role === 'admin')
        throw AppError_1.AppError.badRequest('Cannot change the status of an admin account through this endpoint.');
    user.status = status;
    await user.save();
    await cacheService_1.cache.del(cacheService_1.cacheKeys.user(uid));
    await (0, notification_service_1.notify)({
        userId: uid,
        type: status === 'active' ? 'account_activated' : 'account_deactivated',
        title: status === 'active' ? 'Account activated' : 'Account deactivated',
        message: status === 'active'
            ? 'Your account is active again.'
            : status === 'suspended'
                ? 'Your account has been suspended by the administrator.'
                : 'Your account has been marked as expired. Contact support to renew.',
    });
    await AuditLog_1.AuditLog.create({
        actor: req.reqUser?._id,
        actorRole: 'admin',
        action: 'admin.user_status',
        entity: 'User',
        entityId: uid,
        after: { status },
    });
    res.json({ success: true, data: { user: { _id: user._id, status } } });
});
exports.renewUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.params.id;
    const days = Number(req.body.days ?? env_1.env.ACCOUNT_PERIOD_DAYS);
    if (!Number.isInteger(days) || days < 1 || days > 3650)
        throw AppError_1.AppError.badRequest('Invalid renewal period.');
    const user = await User_1.User.findById(uid);
    if (!user)
        throw AppError_1.AppError.notFound('User not found.');
    const now = new Date();
    const base = user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() > now.getTime() ? new Date(user.subscriptionEnd) : now;
    user.subscriptionEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    user.subscriptionStart = user.subscriptionStart ?? now;
    user.status = 'active';
    await user.save();
    await cacheService_1.cache.del(cacheService_1.cacheKeys.user(uid));
    await (0, notification_service_1.notify)({
        userId: uid,
        type: 'account_activated',
        title: 'Subscription renewed',
        message: `Your subscription has been renewed. New expiry: ${user.subscriptionEnd.toDateString()}.`,
    });
    res.json({ success: true, data: { user: { _id: user._id, status: user.status, subscriptionEnd: user.subscriptionEnd } } });
});
exports.runRetention = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const months = req.body?.months === undefined ? env_1.env.RETENTION_MONTHS : Number(req.body.months);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
        throw AppError_1.AppError.badRequest('Retention period must be between 1 and 120 months.');
    }
    const result = await (0, retention_service_1.runRetention)({
        salonId: req.body.salonId ?? undefined,
        months,
        actor: String(req.reqUser._id),
    });
    res.json({ success: true, data: result });
});
exports.refreshNotifications = (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const count = await (0, notification_service_1.refreshAllSubscriptionNotifications)();
    res.json({ success: true, data: { checked: count } });
});
exports.recentActivity = (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const logs = await AuditLog_1.AuditLog.find({}).sort({ createdAt: -1 }).limit(30).populate('actor', 'username').lean();
    res.json({ success: true, data: { logs } });
});
//# sourceMappingURL=admin.controller.js.map