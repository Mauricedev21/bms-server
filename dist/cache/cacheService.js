"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheKeys = exports.cache = void 0;
exports.invalidateSalon = invalidateSalon;
/**
 * CacheService: Redis-backed when available (ioredis), otherwise a safe
 * in-memory TTL cache. MongoDB remains the authoritative source of truth —
 * this cache is only used to make frequent reads (user identity, lists,
 * dashboard summaries) faster and is always invalidated on writes.
 *
 * Never store raw passwords, secrets or sensitive credentials here.
 */
class CacheService {
    memory = new Map();
    get redis() {
        // lazy import to avoid circular deps / config ordering issues
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getRedis } = require('../config/redis');
        return getRedis();
    }
    async get(key) {
        const r = this.redis;
        if (r) {
            try {
                const raw = await r.get(`bms:${key}`);
                return raw ? JSON.parse(raw) : null;
            }
            catch {
                return null;
            }
        }
        const rec = this.memory.get(key);
        if (!rec)
            return null;
        if (rec.expiresAt < Date.now()) {
            this.memory.delete(key);
            return null;
        }
        return rec.value;
    }
    async set(key, value, ttlSeconds) {
        const r = this.redis;
        if (r) {
            try {
                await r.set(`bms:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
                return;
            }
            catch {
                // fall through to memory
            }
        }
        this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
    async del(key) {
        const r = this.redis;
        if (r) {
            try {
                await r.del(`bms:${key}`);
            }
            catch {
                /* ignore */
            }
        }
        this.memory.delete(key);
    }
    /** Delete all keys matching a prefix pattern (e.g. "salon:abc123:"). */
    async delPrefix(prefix) {
        const r = this.redis;
        if (r) {
            try {
                const keys = await r.keys(`bms:${prefix}*`);
                if (keys.length)
                    await r.del(...keys);
            }
            catch {
                /* ignore */
            }
        }
        for (const key of this.memory.keys()) {
            if (key.startsWith(prefix))
                this.memory.delete(key);
        }
    }
    async flushAll() {
        const r = this.redis;
        if (r) {
            try {
                const keys = await r.keys('bms:*');
                if (keys.length)
                    await r.del(...keys);
            }
            catch {
                /* ignore */
            }
        }
        this.memory.clear();
    }
}
exports.cache = new CacheService();
/** Invalidate everything related to a salon after a financial/record write. */
async function invalidateSalon(salonId) {
    await exports.cache.delPrefix(`dash:${salonId}:`);
    await exports.cache.delPrefix(`wallet:${salonId}!`);
    await exports.cache.delPrefix(`txns:${salonId}:`);
    await exports.cache.delPrefix(`barbers:${salonId}!`);
    await exports.cache.delPrefix(`loans:${salonId}!`);
    await exports.cache.del(`dash:${salonId}`);
    await exports.cache.del(`wallet:${salonId}`);
    await exports.cache.del(`barbers:${salonId}`);
    await exports.cache.del(`loans:${salonId}`);
}
exports.cacheKeys = {
    user: (uid) => `user:${uid}`,
    salon: (salonId) => `salon:${salonId}`,
    dashboard: (salonId) => `dash:${salonId}`,
    barbers: (salonId) => `barbers:${salonId}`,
    barber: (barberId) => `barber:${barberId}`,
    transactions: (salonId, queryKey) => `txns:${salonId}:${queryKey}`,
    loans: (salonId) => `loans:${salonId}`,
    wallet: (salonId) => `wallet:${salonId}`,
    report: (salonId, kind, key) => `report:${salonId}:${kind}:${key}`,
};
//# sourceMappingURL=cacheService.js.map