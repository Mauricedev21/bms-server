import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { User } from '../models/User';
import { Salon } from '../models/Salon';
import { Notification } from '../models/Notification';
import { AppError } from '../utils/AppError';
import { cache, cacheKeys } from '../cache/cacheService';
import { ensureSubscriptionNotification } from '../services/notification.service';
import { auditTrail } from '../services/audit.service';
import { computeDashboardSummary, shares } from '../services/dashboard.service';

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const uid = req.user?._id?.toString() ?? String((req.reqUser as { _id: unknown })._id);
  const { fullName, phone, email } = req.body;

  const clash = await User.findOne({
    _id: { $ne: uid },
    $or: [{ phone: phone.trim() }, { email: email.trim().toLowerCase() }],
  }).select('phone email').lean();
  if (clash) throw AppError.conflict('Another account already uses this phone or email.');

  const user = await User.findById(uid);
  if (!user) throw AppError.notFound('User not found.');
  if (fullName !== undefined) user.fullName = fullName?.trim() ?? '';
  if (phone !== undefined) user.phone = phone?.trim() ?? '';
  if (email !== undefined) user.email = email?.trim().toLowerCase() ?? '';
  await user.save();
  await cache.del(cacheKeys.user(uid));

  res.json({ success: true, data: { user: { _id: user._id, fullName: user.fullName, phone: user.phone, email: user.email } } });
});

export const getSalonSettings = asyncHandler(async (req: Request, res: Response) => {
  const salon = req.salon!;
  const owner = await User.findById(salon.owner).select('username email phone fullName createdAt').lean();
  res.json({ success: true, data: { salon, owner, businessModel: shares() } });
});

export const updateSalonSettings = asyncHandler(async (req: Request, res: Response) => {
  const salon = await Salon.findById(req.salon!._id);
  if (!salon) throw AppError.notFound('Salon not found.');
  const { name, phone, email, address, city, website } = req.body;
  const before = salon.toObject();
  if (name !== undefined) salon.name = name;
  if (phone !== undefined) salon.phone = phone ?? '';
  if (email !== undefined) salon.email = email?.toLowerCase() ?? '';
  if (address !== undefined) salon.address = address ?? '';
  if (city !== undefined) salon.city = city ?? '';
  if (website !== undefined) salon.website = website ?? '';
  await salon.save();

  auditTrail(req, { action: 'salon.updated', entity: 'Salon', entityId: salon._id, salon: String(salon._id), before, after: salon.toObject() });
  await cache.del(cacheKeys.salon(String(salon._id)));

  res.json({ success: true, data: { salon } });
});

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const salonId = String(req.salon!._id);
  const uid = req.user?._id?.toString() ?? String((req.reqUser as { _id: unknown })._id);
  const [summary, notifications] = await Promise.all([
    computeDashboardSummary(salonId),
    ensureSubscriptionNotification(uid).then(() =>
      Notification.find({ user: uid }).sort({ createdAt: -1 }).limit(20).lean(),
    ),
  ]);
  res.json({ success: true, data: { ...summary, notifications } });
});

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const uid = req.user?._id?.toString() ?? String((req.reqUser as { _id: unknown })._id);
  await ensureSubscriptionNotification(uid);
  const notifications = await Notification.find({ user: uid }).sort({ createdAt: -1 }).limit(50).lean();
  const unread = notifications.filter((n) => !n.read).length;
  res.json({ success: true, data: { notifications, unread } });
});

export const markNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const uid = req.user?._id?.toString() ?? String((req.reqUser as { _id: unknown })._id);
  await Notification.updateMany({ user: uid, read: false }, { $set: { read: true } });
  res.json({ success: true, data: { updated: true } });
});