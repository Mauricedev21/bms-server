import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export interface NotificationInput {
  userId: string;
  type?: string;
  title: string;
  message?: string;
  data?: Record<string, unknown>;
}

export async function notify(input: NotificationInput): Promise<void> {
  await Notification.create({
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
export async function ensureSubscriptionNotification(userId: string): Promise<void> {
  try {
    const user = await User.findById(userId).lean();
    if (!user || user.role !== 'manager') return;

    const now = new Date();
    const end = user.subscriptionEnd ? new Date(user.subscriptionEnd).getTime() : now.getTime();
    const daysLeft = Math.max(0, Math.ceil((end - now.getTime()) / (24 * 60 * 60 * 1000)));

    const type = now.getTime() > end ? 'account_expired' : daysLeft <= env.NOTIFICATION_EXPIRY_DAYS ? 'account_expiring' : null;
    if (!type) return;

    const existing = await Notification.findOne({ user: userId, type, read: false }).lean();
    if (existing) return;

    const title =
      type === 'account_expired'
        ? 'Subscription expired'
        : `Subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    const message =
      type === 'account_expired'
        ? `Your ${env.ACCOUNT_PERIOD_DAYS}-day subscription period has ended. Contact support to renew your account.`
        : `Your subscription period ends on ${new Date(end).toDateString()}. Renew to keep your salon active.`;

    await Notification.create({
      user: userId,
      type,
      title,
      message,
      data: { daysLeft, subscriptionEnd: new Date(end).toISOString() },
    });
  } catch (err) {
    logger.warn('[notifications] ensureSubscriptionNotification failed', (err as Error).message);
  }
}

/** Refresh account-status notifications for every manager. */
export async function refreshAllSubscriptionNotifications(): Promise<number> {
  const managers = await User.find({ role: 'manager' }).select('_id').lean();
  for (const m of managers) {
    await ensureSubscriptionNotification(String(m._id));
  }
  return managers.length;
}