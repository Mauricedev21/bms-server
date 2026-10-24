"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageUsage = exports.recentActivity = exports.refreshNotifications = exports.runRetention = exports.renewUser = exports.updateUserStatus = exports.rejectUser = exports.approveUser = exports.createManager = exports.listUsers = exports.dashboard = void 0;
exports.subscriptionBucket = subscriptionBucket;
const mongoose_1 = __importDefault(require("mongoose"));
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
    if (user.status === 'pending')
        return 'pending';
    if (user.status === 'rejected')
        return 'rejected';
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
/**
 * Activate a manager account, provisioning its salon when one does not exist
 * yet (pending/rejected requests never had a salon created at registration).
 */
async function activateWithSalon(user) {
    const salonName = user.requestedSalonName ||
        (user.salon ? null : user.fullName ? `${user.fullName}'s salon` : `${user.username}'s salon`);
    let created = false;
    if (!user.salon) {
        const salon = await Salon_1.Salon.create({
            owner: user._id,
            name: salonName || `${user.username}'s salon`,
            managerSharePercent: env_1.env.MANAGER_SHARE_PERCENT,
            barberSharePercent: env_1.env.BARBER_SHARE_PERCENT,
            currency: env_1.env.CURRENCY,
            status: 'active',
        });
        user.salon = salon._id;
        created = true;
    }
    const now = new Date();
    user.status = 'active';
    user.subscriptionStart = user.subscriptionStart ?? now;
    user.subscriptionEnd =
        user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() > now.getTime()
            ? user.subscriptionEnd
            : new Date(now.getTime() + (user.periodDays ?? env_1.env.ACCOUNT_PERIOD_DAYS) * 24 * 60 * 60 * 1000);
    await user.save();
    await cacheService_1.cache.del(cacheService_1.cacheKeys.user(String(user._id)));
    return { salonName: salonName || `${user.username}'s salon`, created };
}
exports.dashboard = (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const admins = await User_1.User.find({ role: 'admin' }).select('_id').lean();
    const adminIds = admins.map((a) => a._id);
    const managers = await User_1.User.find({ role: 'manager' }).lean();
    const counts = { total: 0, active: 0, pending: 0, expiring: 0, expired: 0, suspended: 0, rejected: 0 };
    for (const m of managers) {
        counts.total++;
        const b = subscriptionBucket(m);
        counts[b]++;
    }
    const [barberCount, txnCount, loanCount, activeLoanCount, recentRegistrations, pendingRequests, notifications] = await Promise.all([
        Barber_1.Barber.countDocuments(),
        Transaction_1.Transaction.countDocuments({ status: 'completed' }),
        Loan_1.Loan.countDocuments(),
        Loan_1.Loan.countDocuments({ status: 'active' }),
        User_1.User.find({ role: 'manager', status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(8).select('username fullName phone email salon createdAt status subscriptionEnd lastActiveAt').lean(),
        User_1.User.find({ role: 'manager', status: 'pending' }).sort({ createdAt: -1 }).limit(10).select('username fullName phone email requestedSalonName createdAt').lean(),
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
            pendingRequests,
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
    if (status === 'expired' || status === 'expiring') {
        // Bucket-based filters: "expired"/"expiring" describe the SUBSCRIPTION
        // date, not the stored status field, so they match the dashboard counts.
        const now = Date.now();
        if (status === 'expired') {
            query.$and = [{ status: { $nin: ['pending', 'rejected', 'suspended'] } }, { subscriptionEnd: { $lt: new Date(now) } }];
        }
        else {
            const soon = new Date(now + env_1.env.NOTIFICATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
            query.$and = [
                { status: { $nin: ['pending', 'rejected', 'suspended'] } },
                { subscriptionEnd: { $gte: new Date(now), $lte: soon } },
            ];
        }
    }
    else if (status) {
        query.status = status;
    }
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
        requestedSalonName: u.requestedSalonName || '',
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
/** Approve a pending access request: creates the salon and activates the account. */
exports.approveUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.params.id;
    const user = await User_1.User.findById(uid);
    if (!user)
        throw AppError_1.AppError.notFound('User not found.');
    if (user.status !== 'pending' && user.status !== 'rejected') {
        throw AppError_1.AppError.badRequest('Only pending or rejected access requests can be approved.');
    }
    const { salonName } = await activateWithSalon(user);
    await (0, notification_service_1.notify)({
        userId: uid,
        type: 'account_activated',
        title: 'Access granted',
        message: `Your access request has been approved. You can now sign in to manage "${salonName}".`,
        data: { salonId: String(user.salon) },
    });
    await AuditLog_1.AuditLog.create({
        actor: req.reqUser?._id,
        actorRole: 'admin',
        action: 'admin.request_approved',
        entity: 'User',
        entityId: uid,
        after: { salonName, salon: String(user.salon) },
    });
    res.json({
        success: true,
        data: {
            user: { _id: user._id, status: user.status },
            salon: { _id: user.salon, name: salonName },
        },
    });
});
/** Reject a pending access request: the account stays blocked and manageable. */
exports.rejectUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.params.id;
    const user = await User_1.User.findById(uid);
    if (!user)
        throw AppError_1.AppError.notFound('User not found.');
    if (user.status !== 'pending')
        throw AppError_1.AppError.badRequest('Only pending access requests can be rejected.');
    if (user.role === 'admin')
        throw AppError_1.AppError.badRequest('Cannot reject an admin account.');
    const snapshot = {
        username: user.username,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        requestedSalonName: user.requestedSalonName,
    };
    // The record is kept (never deleted) so the request remains visible and
    // manageable in the Admin Panel, but access stays blocked: login and every
    // protected route refuse 'rejected' accounts.
    user.status = 'rejected';
    await user.save();
    await cacheService_1.cache.del(cacheService_1.cacheKeys.user(uid));
    await AuditLog_1.AuditLog.create({
        actor: req.reqUser?._id,
        actorRole: 'admin',
        action: 'admin.request_rejected',
        entity: 'User',
        entityId: uid,
        after: { ...snapshot, status: 'rejected' },
    });
    res.json({ success: true, data: { user: { _id: uid, status: 'rejected' } } });
});
exports.updateUserStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.params.id;
    const status = req.body.status;
    const user = await User_1.User.findById(uid);
    if (!user)
        throw AppError_1.AppError.notFound('User not found.');
    if (user.role === 'admin')
        throw AppError_1.AppError.badRequest('Cannot change the status of an admin account through this endpoint.');
    if (status === 'active') {
        // Reactivating a pending/rejected/suspended account must also provision
        // its salon, otherwise the manager could sign in with no salon assigned.
        const { salonName } = await activateWithSalon(user);
        await (0, notification_service_1.notify)({
            userId: uid,
            type: 'account_activated',
            title: 'Account activated',
            message: `Your account is active again${user.salon ? ` and "${salonName}" is ready` : ''}.`,
        });
    }
    else {
        user.status = status;
        await user.save();
        await cacheService_1.cache.del(cacheService_1.cacheKeys.user(uid));
        await (0, notification_service_1.notify)({
            userId: uid,
            type: 'account_deactivated',
            title: 'Account deactivated',
            message: status === 'suspended'
                ? 'Your account has been suspended by the administrator.'
                : 'Your account has been marked as expired. Contact support to renew.',
        });
    }
    await AuditLog_1.AuditLog.create({
        actor: req.reqUser?._id,
        actorRole: 'admin',
        action: 'admin.user_status',
        entity: 'User',
        entityId: uid,
        after: { status },
    });
    res.json({ success: true, data: { user: { _id: user._id, status: user.status, salon: user.salon ?? null } } });
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
const round2 = (n) => Math.round(n * 100) / 100;
/**
 * GET /api/admin/storage — database usage for the admin dashboard widget.
 *
 * Uses MongoDB's `dbStats` command, which is supported both by a local
 * MongoDB and by MongoDB Atlas, so it behaves the same in development and
 * when hosted. The total/quota comes from the DB_STORAGE_LIMIT_MB env var
 * (defaults to 512 MB — the Atlas free tier) and falls back to the
 * database-reported filesystem size when no quota is configured. Any failure
 * degrades gracefully to `{ available: false }` instead of erroring, so the
 * dashboard never breaks because of this widget. Results are cached briefly.
 */
exports.storageUsage = (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const CACHE_KEY = 'admin:storage';
    const cached = await cacheService_1.cache.get(CACHE_KEY);
    if (cached) {
        res.json({ success: true, data: cached });
        return;
    }
    const build = async () => {
        const db = mongoose_1.default.connection.db;
        if (!db)
            throw new Error('database not connected');
        const stats = (await db.command({ dbStats: 1 }));
        const usedMb = round2((stats.storageSize ?? 0) / (1024 * 1024));
        const dataMb = round2((stats.dataSize ?? 0) / (1024 * 1024));
        const quotaMb = env_1.env.DB_STORAGE_LIMIT_MB > 0 ? env_1.env.DB_STORAGE_LIMIT_MB : 0;
        let totalMb = quotaMb;
        let source = quotaMb > 0 ? 'config' : 'none';
        if (totalMb <= 0 && stats.fsTotalSize && stats.fsTotalSize > 0) {
            totalMb = round2(stats.fsTotalSize / (1024 * 1024));
            source = 'filesystem';
        }
        const percent = totalMb > 0 ? Math.min(100, round2((usedMb / totalMb) * 100)) : null;
        const remainingMb = totalMb > 0 ? round2(Math.max(0, totalMb - usedMb)) : null;
        return {
            available: true,
            usedMb,
            dataMb,
            totalMb: totalMb > 0 ? totalMb : null,
            percent,
            remainingMb,
            source,
            collections: stats.collections ?? 0,
            objects: stats.objects ?? 0,
            updatedAt: new Date().toISOString(),
        };
    };
    let payload;
    try {
        payload = await build();
    }
    catch (err) {
        payload = {
            available: false,
            usedMb: 0,
            dataMb: 0,
            totalMb: null,
            percent: null,
            remainingMb: null,
            source: 'none',
            collections: 0,
            objects: 0,
            error: err instanceof Error ? err.message : 'storage stats unavailable',
            updatedAt: new Date().toISOString(),
        };
    }
    await cacheService_1.cache.set(CACHE_KEY, payload, 60);
    res.json({ success: true, data: payload });
});
//# sourceMappingURL=admin.controller.js.map