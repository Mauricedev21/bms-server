"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePassword = exports.logout = exports.me = exports.login = exports.register = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const User_1 = require("../models/User");
const Salon_1 = require("../models/Salon");
const Notification_1 = require("../models/Notification");
const tokens_1 = require("../utils/tokens");
const cacheService_1 = require("../cache/cacheService");
const env_1 = require("../config/env");
const notification_service_1 = require("../services/notification.service");
const audit_service_1 = require("../services/audit.service");
const barberPortal_service_1 = require("../services/barberPortal.service");
const rateLimiter_1 = require("../middleware/rateLimiter");
/** Used so unknown-user logins take the same bcrypt time as known ones (timing-attack hardening). */
const DUMMY_PASSWORD_HASH = '$2a$10$WOSwsmK56kGEZn1SKF4kJuI2cC/8.WVyrh.acf8QhIWyNINHL2hx.';
const publicUser = (u) => ({
    _id: u._id,
    username: u.username,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    role: u.role,
    status: u.status,
    salon: u.salon ?? null,
    subscriptionStart: u.subscriptionStart ?? null,
    subscriptionEnd: u.subscriptionEnd ?? null,
    periodDays: u.periodDays ?? env_1.env.ACCOUNT_PERIOD_DAYS,
    lastActiveAt: u.lastActiveAt ?? null,
    createdAt: u.createdAt ?? null,
});
exports.register = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { username: rawUsername, fullName, phone, email, password, salonName } = req.body;
    const username = String(rawUsername).trim().toLowerCase();
    const existing = await User_1.User.findOne({ $or: [{ username }, { phone }, { email }] }).select('username phone email').lean();
    if (existing) {
        const field = existing.username === username.toLowerCase() ? 'username'
            : existing.phone === phone ? 'phone'
                : 'email';
        throw AppError_1.AppError.conflict(`An account already exists with this ${field}.`, { field });
    }
    // Access requests are created in a 'pending' state. A salon is only created
    // (and the account activated) once an administrator approves the request, so
    // no credentials, session token or salon are exposed before review.
    const user = await User_1.User.create({
        username,
        fullName,
        phone,
        email,
        passwordHash: password,
        role: 'manager',
        status: 'pending',
        requestedSalonName: salonName,
    });
    (0, audit_service_1.auditTrail)(null, {
        action: 'auth.access_requested',
        entity: 'User',
        entityId: user._id,
        after: { username, fullName, email, phone, requestedSalonName: salonName },
        meta: { actorRole: 'system' },
    });
    // Notify all admins so the request shows up in the Admin Panel as Pending.
    // Notification failures must never fail the registration itself.
    try {
        const admins = await User_1.User.find({ role: 'admin' }).select('_id').lean();
        for (const a of admins) {
            await Notification_1.Notification.create({
                user: a._id,
                type: 'access_request',
                title: 'New access request',
                message: `${fullName || username} requested access for the salon "${salonName}".`,
                data: { userId: String(user._id), username, fullName, email, phone, salonName },
            });
        }
    }
    catch (err) {
        console.warn('[register] admin notification failed', err.message);
    }
    res.status(201).json({
        success: true,
        data: {
            request: {
                _id: user._id,
                username: user.username,
                email: user.email,
                status: user.status,
                requestedSalonName: salonName,
                createdAt: user.createdAt,
            },
        },
    });
});
exports.login = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { identifier, password } = req.body;
    const normalized = String(identifier).trim().toLowerCase();
    (0, rateLimiter_1.checkLoginAttempts)(normalized);
    const user = await User_1.User.findOne({ $or: [{ username: normalized }, { phone: normalized }, { email: normalized }] })
        .select('+passwordHash')
        .lean();
    const ok = await bcryptjs_1.default.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !ok) {
        (0, rateLimiter_1.recordLoginAttempt)(normalized);
        throw AppError_1.AppError.unauthorized('Invalid credentials.');
    }
    (0, rateLimiter_1.clearLoginAttempts)(normalized);
    if (user.status === 'pending')
        throw AppError_1.AppError.forbidden('Your account is pending approval. Please wait for an administrator to activate it.');
    if (user.status === 'rejected')
        throw AppError_1.AppError.forbidden('Your access request was not approved. Contact support for more information.');
    if (user.status === 'suspended')
        throw AppError_1.AppError.forbidden('This account has been suspended. Contact support.');
    if (user.status === 'expired')
        throw AppError_1.AppError.forbidden('Subscription expired. Contact support to renew.');
    const salon = user.salon ? await Salon_1.Salon.findById(user.salon).lean() : null;
    const role = user.role;
    const token = (0, tokens_1.signToken)({
        uid: String(user._id),
        role: role,
        salon: salon ? String(salon._id) : undefined,
    });
    await User_1.User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } });
    await (0, notification_service_1.ensureSubscriptionNotification)(String(user._id));
    res.json({
        success: true,
        data: {
            token,
            user: publicUser(user),
            salon: salon
                ? { _id: salon._id, name: salon.name, managerSharePercent: salon.managerSharePercent, barberSharePercent: salon.barberSharePercent, currency: salon.currency }
                : null,
        },
    });
});
exports.me = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (req.barber) {
        const barber = req.barber;
        const { netEarnings, transactionCount, transactionVolume } = await barberPortal_service_1.barberPortalService.summary(String(barber.salon), String(barber._id));
        res.json({
            success: true,
            data: {
                role: 'barber',
                barber: { ...barber, accessPinHash: undefined },
                summary: { netEarnings, transactionCount, transactionVolume },
            },
        });
        return;
    }
    const uid = req.user?._id?.toString() ?? String(req.reqUser._id);
    const user = await User_1.User.findById(uid).lean();
    if (!user)
        throw AppError_1.AppError.unauthorized();
    const salon = user.salon ? await Salon_1.Salon.findById(user.salon).lean() : null;
    res.json({
        success: true,
        data: {
            user: publicUser(user),
            salon: salon ? { ...salon, _id: salon._id } : null,
        },
    });
});
exports.logout = (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    res.json({ success: true, data: { message: 'Logged out' } });
});
exports.changePassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = String(req.reqUser._id);
    const user = await User_1.User.findById(uid).select('+passwordHash');
    if (!user)
        throw AppError_1.AppError.notFound('User not found.');
    const ok = await user.comparePassword(req.body.currentPassword);
    if (!ok)
        throw AppError_1.AppError.badRequest('Current password is incorrect.');
    user.passwordHash = req.body.newPassword;
    await user.save();
    await cacheService_1.cache.del(cacheService_1.cacheKeys.user(uid));
    (0, audit_service_1.auditTrail)(req, { action: 'auth.password_changed', entity: 'User', entityId: uid });
    // Notify every administrator that a password changed — never include the
    // password itself or any other authentication secret. Failures here must
    // not undo the already-saved password change.
    if (user.role === 'manager') {
        try {
            const admins = await User_1.User.find({ role: 'admin' }).select('_id').lean();
            for (const a of admins) {
                await Notification_1.Notification.create({
                    user: a._id,
                    type: 'security',
                    title: 'Password changed',
                    message: `Manager ${user.fullName || user.username} changed their account password. No credentials are shared with this notification.`,
                    data: { userId: uid, username: user.username },
                });
            }
        }
        catch (err) {
            console.warn('[changePassword] admin notification failed', err.message);
        }
    }
    res.json({ success: true, data: { message: 'Password updated successfully.' } });
});
//# sourceMappingURL=auth.controller.js.map