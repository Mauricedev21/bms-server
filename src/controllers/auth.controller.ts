import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { User } from '../models/User';
import { Salon } from '../models/Salon';
import { Notification } from '../models/Notification';
import { signToken } from '../utils/tokens';
import { cache, cacheKeys } from '../cache/cacheService';
import { env } from '../config/env';
import { ensureSubscriptionNotification } from '../services/notification.service';
import { auditTrail } from '../services/audit.service';
import { barberPortalService } from '../services/barberPortal.service';
import { checkLoginAttempts, recordLoginAttempt, clearLoginAttempts } from '../middleware/rateLimiter';

/** Used so unknown-user logins take the same bcrypt time as known ones (timing-attack hardening). */
const DUMMY_PASSWORD_HASH = '$2a$10$WOSwsmK56kGEZn1SKF4kJuI2cC/8.WVyrh.acf8QhIWyNINHL2hx.';

const publicUser = (u: Record<string, unknown>) => ({
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
  periodDays: u.periodDays ?? env.ACCOUNT_PERIOD_DAYS,
  lastActiveAt: u.lastActiveAt ?? null,
  createdAt: u.createdAt ?? null,
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { username: rawUsername, fullName, phone, email, password, salonName } = req.body;
  const username = String(rawUsername).trim().toLowerCase();

  const existing = await User.findOne({ $or: [{ username }, { phone }, { email }] }).select('username phone email').lean();
  if (existing) {
    const field =
      existing.username === username.toLowerCase() ? 'username'
      : existing.phone === phone ? 'phone'
      : 'email';
    throw AppError.conflict(`An account already exists with this ${field}.`, { field });
  }

  const user = await User.create({
    username,
    fullName,
    phone,
    email,
    passwordHash: password,
    role: 'manager',
    status: 'active',
  });

  const salon = await Salon.create({
    owner: user._id,
    name: salonName,
    managerSharePercent: env.MANAGER_SHARE_PERCENT,
    barberSharePercent: env.BARBER_SHARE_PERCENT,
    currency: env.CURRENCY,
    status: 'active',
  });

  user.salon = salon._id;
  await user.save();

  auditTrail(null, {
    action: 'auth.register',
    entity: 'User',
    entityId: user._id,
    salon: String(salon._id),
    after: { username, salonName },
    meta: { actorRole: 'system' },
  });

  // Notify all admins of the new registration.
  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  for (const a of admins) {
    await Notification.create({
      user: a._id,
      type: 'new_registration',
      title: 'New salon registered',
      message: `"${salonName}" registered by ${username} (${phone}).`,
      data: { userId: String(user._id), salonId: String(salon._id), username, phone },
    });
  }

  const token = signToken({ uid: String(user._id), role: 'manager', salon: String(salon._id) });

  res.status(201).json({
    success: true,
    data: {
      token,
      user: publicUser(user.toObject()),
      salon: { _id: salon._id, name: salon.name, managerSharePercent: salon.managerSharePercent, barberSharePercent: salon.barberSharePercent, currency: salon.currency },
    },
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  const normalized = String(identifier).trim().toLowerCase();

  checkLoginAttempts(normalized);

  const user = await User.findOne({ $or: [{ username: normalized }, { phone: normalized }, { email: normalized }] })
    .select('+passwordHash')
    .lean();
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) {
    recordLoginAttempt(normalized);
    throw AppError.unauthorized('Invalid credentials.');
  }
  clearLoginAttempts(normalized);

  if (user.status === 'suspended') throw AppError.forbidden('This account has been suspended. Contact support.');
  if (user.status === 'expired') throw AppError.forbidden('Subscription expired. Contact support to renew.');

  const salon = user.salon ? await Salon.findById(user.salon).lean() : null;
  const role = user.role;
  const token = signToken({
    uid: String(user._id),
    role: role,
    salon: salon ? String(salon._id) : undefined,
  });

  await User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } });
  await ensureSubscriptionNotification(String(user._id));

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

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (req.barber) {
    const barber = req.barber as unknown as { _id: unknown; name: string; phone: string; salon: unknown; status: string };
    const { netEarnings, transactionCount, transactionVolume } = await barberPortalService.summary(String(barber.salon), String(barber._id));
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

  const uid = req.user?._id?.toString() ?? String((req.reqUser as { _id: unknown })._id);
  const user = await User.findById(uid).lean();
  if (!user) throw AppError.unauthorized();

  const salon = user.salon ? await Salon.findById(user.salon).lean() : null;

  res.json({
    success: true,
    data: {
      user: publicUser(user),
      salon: salon ? { ...salon, _id: salon._id } : null,
    },
  });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { message: 'Logged out' } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const uid = String(req.reqUser!._id);
  const user = await User.findById(uid).select('+passwordHash');
  if (!user) throw AppError.notFound('User not found.');
  const ok = await user.comparePassword(req.body.currentPassword);
  if (!ok) throw AppError.badRequest('Current password is incorrect.');
  user.passwordHash = req.body.newPassword;
  await user.save();
  await cache.del(cacheKeys.user(uid));
  auditTrail(req, { action: 'auth.password_changed', entity: 'User', entityId: uid });
  res.json({ success: true, data: { message: 'Password updated successfully.' } });
});