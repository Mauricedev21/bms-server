"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.managerOnly = exports.adminOnly = exports.protect = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const tokens_1 = require("../utils/tokens");
const User_1 = require("../models/User");
const Salon_1 = require("../models/Salon");
const Barber_1 = require("../models/Barber");
const cacheService_1 = require("../cache/cacheService");
const env_1 = require("../config/env");
async function loadUser(uid) {
    const cached = await cacheService_1.cache.get(cacheService_1.cacheKeys.user(uid));
    if (cached) {
        return {
            _id: cached.id,
            status: cached.status,
            salon: cached.salon ?? undefined,
            role: cached.role,
            isPopulatedMe: true,
        };
    }
    const user = await User_1.User.findById(uid).select('+passwordHash').lean();
    if (!user)
        return null;
    await cacheService_1.cache.set(cacheService_1.cacheKeys.user(uid), { id: String(user._id), status: user.status, salon: String(user.salon ?? ''), role: user.role }, env_1.env.CACHE_TTL_USER);
    return user;
}
function bearerToken(req) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer '))
        return header.slice(7).trim();
    const cookie = req.headers.cookie;
    if (cookie) {
        const match = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('bms_token='));
        if (match)
            return match.slice('bms_token='.length);
    }
    return null;
}
exports.protect = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
    const token = bearerToken(req);
    if (!token)
        throw AppError_1.AppError.unauthorized('Missing authentication token');
    const payload = (0, tokens_1.verifyToken)(token);
    if (payload.role === 'barber') {
        const barber = await Barber_1.Barber.findById(payload.barber).lean();
        if (!barber || barber.status !== 'active')
            throw AppError_1.AppError.unauthorized('Barber account is not active');
        if (payload.salon && String(barber.salon) !== payload.salon) {
            throw AppError_1.AppError.unauthorized('Barber token no longer matches the assigned salon');
        }
        req.barber = barber;
        req.reqUser = barber;
        next();
        return;
    }
    const user = await loadUser(payload.uid);
    if (!user)
        throw AppError_1.AppError.unauthorized('User account no longer exists');
    if (user.status === 'suspended')
        throw AppError_1.AppError.forbidden('This account has been suspended');
    if (user.status === 'expired')
        throw AppError_1.AppError.forbidden('Subscription expired. Please contact support to renew.');
    req.reqUser = user;
    if (payload.role === 'admin') {
        next();
        return;
    }
    // Manager: enforce strict tenant isolation by loading only the salon this
    // manager owns. Everything downstream must filter by req.salon._id.
    const salonId = user.salon ? String(user.salon) : payload.salon;
    if (!salonId)
        throw AppError_1.AppError.forbidden('No salon assigned to this account');
    const salon = await Salon_1.Salon.findById(salonId).lean();
    if (!salon)
        throw AppError_1.AppError.forbidden('Salon not found for this account');
    if (String(salon.owner) !== String(user._id) && payload.role === 'manager') {
        throw AppError_1.AppError.forbidden('You do not have access to this salon');
    }
    req.salon = salon;
    // Throttle lastActiveAt writes (once per hour at most).
    const now = Date.now();
    if (!user.lastActiveAt || now - new Date(user.lastActiveAt).getTime() > 60 * 60 * 1000) {
        void User_1.User.findByIdAndUpdate(user._id, { lastActiveAt: new Date() }).exec();
    }
    next();
});
exports.adminOnly = (0, asyncHandler_1.asyncHandler)(async (req, _res, next) => {
    const uid = String(req.reqUser?._id ?? req.reqUser?._id);
    // Authoritative database check for every admin request — never trust cached
    // identity for permission decisions.
    const dbUser = await User_1.User.findById(uid).select('role status').lean();
    if (!dbUser || dbUser.role !== 'admin' || dbUser.status !== 'active') {
        throw AppError_1.AppError.forbidden('Admin access required');
    }
    next();
});
/** Ensure the request is a manager (not admin). */
exports.managerOnly = (0, asyncHandler_1.asyncHandler)(async (req, _res, next) => {
    if (!req.reqUser || !req.salon)
        throw AppError_1.AppError.forbidden('Manager only');
    next();
});
//# sourceMappingURL=auth.js.map