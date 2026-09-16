"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationsRead = exports.getNotifications = exports.getDashboard = exports.updateSalonSettings = exports.getSalonSettings = exports.updateProfile = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const User_1 = require("../models/User");
const Salon_1 = require("../models/Salon");
const Notification_1 = require("../models/Notification");
const AppError_1 = require("../utils/AppError");
const cacheService_1 = require("../cache/cacheService");
const notification_service_1 = require("../services/notification.service");
const audit_service_1 = require("../services/audit.service");
const dashboard_service_1 = require("../services/dashboard.service");
exports.updateProfile = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.user?._id?.toString() ?? String(req.reqUser._id);
    const { fullName, phone, email } = req.body;
    const clash = await User_1.User.findOne({
        _id: { $ne: uid },
        $or: [{ phone: phone.trim() }, { email: email.trim().toLowerCase() }],
    }).select('phone email').lean();
    if (clash)
        throw AppError_1.AppError.conflict('Another account already uses this phone or email.');
    const user = await User_1.User.findById(uid);
    if (!user)
        throw AppError_1.AppError.notFound('User not found.');
    if (fullName !== undefined)
        user.fullName = fullName?.trim() ?? '';
    if (phone !== undefined)
        user.phone = phone?.trim() ?? '';
    if (email !== undefined)
        user.email = email?.trim().toLowerCase() ?? '';
    await user.save();
    await cacheService_1.cache.del(cacheService_1.cacheKeys.user(uid));
    res.json({ success: true, data: { user: { _id: user._id, fullName: user.fullName, phone: user.phone, email: user.email } } });
});
exports.getSalonSettings = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const salon = req.salon;
    const owner = await User_1.User.findById(salon.owner).select('username email phone fullName createdAt').lean();
    res.json({ success: true, data: { salon, owner, businessModel: (0, dashboard_service_1.shares)() } });
});
exports.updateSalonSettings = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const salon = await Salon_1.Salon.findById(req.salon._id);
    if (!salon)
        throw AppError_1.AppError.notFound('Salon not found.');
    const { name, phone, email, address, city, website } = req.body;
    const before = salon.toObject();
    if (name !== undefined)
        salon.name = name;
    if (phone !== undefined)
        salon.phone = phone ?? '';
    if (email !== undefined)
        salon.email = email?.toLowerCase() ?? '';
    if (address !== undefined)
        salon.address = address ?? '';
    if (city !== undefined)
        salon.city = city ?? '';
    if (website !== undefined)
        salon.website = website ?? '';
    await salon.save();
    (0, audit_service_1.auditTrail)(req, { action: 'salon.updated', entity: 'Salon', entityId: salon._id, salon: String(salon._id), before, after: salon.toObject() });
    await cacheService_1.cache.del(cacheService_1.cacheKeys.salon(String(salon._id)));
    res.json({ success: true, data: { salon } });
});
exports.getDashboard = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const salonId = String(req.salon._id);
    const uid = req.user?._id?.toString() ?? String(req.reqUser._id);
    const [summary, notifications] = await Promise.all([
        (0, dashboard_service_1.computeDashboardSummary)(salonId),
        (0, notification_service_1.ensureSubscriptionNotification)(uid).then(() => Notification_1.Notification.find({ user: uid }).sort({ createdAt: -1 }).limit(20).lean()),
    ]);
    res.json({ success: true, data: { ...summary, notifications } });
});
exports.getNotifications = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.user?._id?.toString() ?? String(req.reqUser._id);
    await (0, notification_service_1.ensureSubscriptionNotification)(uid);
    const notifications = await Notification_1.Notification.find({ user: uid }).sort({ createdAt: -1 }).limit(50).lean();
    const unread = notifications.filter((n) => !n.read).length;
    res.json({ success: true, data: { notifications, unread } });
});
exports.markNotificationsRead = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.user?._id?.toString() ?? String(req.reqUser._id);
    await Notification_1.Notification.updateMany({ user: uid, read: false }, { $set: { read: true } });
    res.json({ success: true, data: { updated: true } });
});
//# sourceMappingURL=user.controller.js.map