import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { verifyToken } from '../utils/tokens';
import { User, type UserDocument } from '../models/User';
import { Salon, type SalonDocument } from '../models/Salon';
import { Barber, type BarberDocument } from '../models/Barber';
import { cache, cacheKeys } from '../cache/cacheService';
import { env } from '../config/env';

export type AuthRole = 'manager' | 'admin' | 'barber';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserDocument;
    reqUser?: UserDocument;
    salon?: SalonDocument;
    barber?: BarberDocument;
  }
}

async function loadUser(uid: string): Promise<UserDocument | null> {
  const cached = await cache.get<{ id: string; status: string; salon: string | null; role: string }>(
    cacheKeys.user(uid),
  );
  if (cached) {
    return {
      _id: cached.id as unknown as UserDocument['_id'],
      status: cached.status,
      salon: cached.salon ?? (undefined as unknown as UserDocument['salon']),
      role: cached.role,
      isPopulatedMe: true,
    } as unknown as UserDocument;
  }
  const user = await User.findById(uid).select('+passwordHash').lean();
  if (!user) return null;
  await cache.set(
    cacheKeys.user(uid),
    { id: String(user._id), status: user.status, salon: String(user.salon ?? ''), role: user.role },
    env.CACHE_TTL_USER,
  );
  return user as unknown as UserDocument;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('bms_token='));
    if (match) return match.slice('bms_token='.length);
  }
  return null;
}

export const protect = asyncHandler(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) throw AppError.unauthorized('Missing authentication token');
  const payload = verifyToken(token);

  if (payload.role === 'barber') {
    const barber = await Barber.findById(payload.barber).lean();
    if (!barber || barber.status !== 'active') throw AppError.unauthorized('Barber account is not active');
    if (payload.salon && String(barber.salon) !== payload.salon) {
      throw AppError.unauthorized('Barber token no longer matches the assigned salon');
    }
    req.barber = barber as unknown as BarberDocument;
    req.reqUser = barber as unknown as UserDocument;
    next();
    return;
  }

  const user = await loadUser(payload.uid);
  if (!user) throw AppError.unauthorized('User account no longer exists');
  if (user.status === 'suspended') throw AppError.forbidden('This account has been suspended');
  if (user.status === 'expired') throw AppError.forbidden('Subscription expired. Please contact support to renew.');

  req.reqUser = user;

  if (payload.role === 'admin') {
    next();
    return;
  }

  // Manager: enforce strict tenant isolation by loading only the salon this
  // manager owns. Everything downstream must filter by req.salon._id.
  const salonId = user.salon ? String(user.salon) : payload.salon;
  if (!salonId) throw AppError.forbidden('No salon assigned to this account');
  const salon = await Salon.findById(salonId).lean();
  if (!salon) throw AppError.forbidden('Salon not found for this account');
  if (String(salon.owner) !== String(user._id) && payload.role === 'manager') {
    throw AppError.forbidden('You do not have access to this salon');
  }
  req.salon = salon as unknown as SalonDocument;

  // Throttle lastActiveAt writes (once per hour at most).
  const now = Date.now();
  if (!user.lastActiveAt || now - new Date(user.lastActiveAt).getTime() > 60 * 60 * 1000) {
    void User.findByIdAndUpdate(user._id, { lastActiveAt: new Date() }).exec();
  }
  next();
});

export const adminOnly = asyncHandler(async (req, _res, next) => {
  const uid = String((req as Request & { reqUser?: { _id?: unknown } }).reqUser?._id ?? req.reqUser?._id);
  // Authoritative database check for every admin request — never trust cached
  // identity for permission decisions.
  const dbUser = await User.findById(uid).select('role status').lean();
  if (!dbUser || dbUser.role !== 'admin' || dbUser.status !== 'active') {
    throw AppError.forbidden('Admin access required');
  }
  next();
});

/** Ensure the request is a manager (not admin). */
export const managerOnly = asyncHandler(async (req, _res, next) => {
  if (!req.reqUser || !req.salon) throw AppError.forbidden('Manager only');
  next();
});