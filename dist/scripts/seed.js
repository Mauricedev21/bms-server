"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const User_1 = require("../models/User");
const logger_1 = require("../utils/logger");
/**
 * Seeds the platform administrator account (no fake business data is created).
 * Run: npm run seed
 *
 * The default credentials match the system owner's admin account. Override any
 * of them via ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_PHONE.
 */
async function seedAdmin() {
    await (0, db_1.connectDB)();
    const username = process.env.ADMIN_USERNAME || 'admin';
    const email = process.env.ADMIN_EMAIL || 'hirwajules2000@gmail.com';
    const password = process.env.ADMIN_PASSWORD || '2k2026@G';
    const phone = process.env.ADMIN_PHONE || '+250700000000';
    const existing = await User_1.User.findOne({ $or: [{ username }, { email }] }).lean();
    if (existing) {
        logger_1.logger.info(`[seed] admin already exists (${existing.username}) — no changes made.`);
    }
    else {
        await User_1.User.create({
            username,
            fullName: 'Platform Administrator',
            phone,
            email,
            passwordHash: password,
            role: 'admin',
            status: 'active',
        });
        logger_1.logger.info(`[seed] admin created — username: ${username}, email: ${email}`);
    }
    await (0, db_1.disconnectDB)();
}
seedAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
    logger_1.logger.error('[seed] failed', err.message);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map