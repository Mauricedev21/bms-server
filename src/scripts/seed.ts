import { connectDB, disconnectDB } from '../config/db';
import { User } from '../models/User';
import { logger } from '../utils/logger';

/**
 * Seeds the platform administrator account (no fake business data is created).
 * Run: npm run seed
 *
 * The default credentials match the system owner's admin account. Override any
 * of them via ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_PHONE.
 */
async function seedAdmin(): Promise<void> {
  await connectDB();
  const username = process.env.ADMIN_USERNAME || 'admin';
  const email = process.env.ADMIN_EMAIL || 'hirwajules2000@gmail.com';
  const password = process.env.ADMIN_PASSWORD || '2k2026@G';
  const phone = process.env.ADMIN_PHONE || '+250700000000';

  const existing = await User.findOne({ $or: [{ username }, { email }] }).lean();
  if (existing) {
    logger.info(`[seed] admin already exists (${existing.username}) — no changes made.`);
  } else {
    await User.create({
      username,
      fullName: 'Platform Administrator',
      phone,
      email,
      passwordHash: password,
      role: 'admin',
      status: 'active',
    });
    logger.info(`[seed] admin created — username: ${username}, email: ${email}`);
  }

  await disconnectDB();
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('[seed] failed', err.message);
    process.exit(1);
  });