type CacheRecord = { value: unknown; expiresAt: number };

/**
 * CacheService: Redis-backed when available (ioredis), otherwise a safe
 * in-memory TTL cache. MongoDB remains the authoritative source of truth —
 * this cache is only used to make frequent reads (user identity, lists,
 * dashboard summaries) faster and is always invalidated on writes.
 *
 * Never store raw passwords, secrets or sensitive credentials here.
 */
class CacheService {
  private memory: Map<string, CacheRecord> = new Map();

  private get redis() {
    // lazy import to avoid circular deps / config ordering issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getRedis } = require('../config/redis') as typeof import('../config/redis');
    return getRedis();
  }

  async get<T>(key: string): Promise<T | null> {
    const r = this.redis;
    if (r) {
      try {
        const raw = await r.get(`bms:${key}`);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    }
    const rec = this.memory.get(key);
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return rec.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const r = this.redis;
    if (r) {
      try {
        await r.set(`bms:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
        return;
      } catch {
        // fall through to memory
      }
    }
    this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    const r = this.redis;
    if (r) {
      try {
        await r.del(`bms:${key}`);
      } catch {
        /* ignore */
      }
    }
    this.memory.delete(key);
  }

  /** Delete all keys matching a prefix pattern (e.g. "salon:abc123:"). */
  async delPrefix(prefix: string): Promise<void> {
    const r = this.redis;
    if (r) {
      try {
        const keys = await r.keys(`bms:${prefix}*`);
        if (keys.length) await r.del(...keys);
      } catch {
        /* ignore */
      }
    }
    for (const key of this.memory.keys()) {
      if (key.startsWith(prefix)) this.memory.delete(key);
    }
  }

  async flushAll(): Promise<void> {
    const r = this.redis;
    if (r) {
      try {
        const keys = await r.keys('bms:*');
        if (keys.length) await r.del(...keys);
      } catch {
        /* ignore */
      }
    }
    this.memory.clear();
  }
}

export const cache = new CacheService();

/** Invalidate everything related to a salon after a financial/record write. */
export async function invalidateSalon(salonId: string): Promise<void> {
  await cache.delPrefix(`dash:${salonId}:`);
  await cache.delPrefix(`wallet:${salonId}!`);
  await cache.delPrefix(`txns:${salonId}:`);
  await cache.delPrefix(`barbers:${salonId}!`);
  await cache.delPrefix(`loans:${salonId}!`);
  await cache.del(`dash:${salonId}`);
  await cache.del(`wallet:${salonId}`);
  await cache.del(`barbers:${salonId}`);
  await cache.del(`loans:${salonId}`);
}

export const cacheKeys = {
  user: (uid: string) => `user:${uid}`,
  salon: (salonId: string) => `salon:${salonId}`,
  dashboard: (salonId: string) => `dash:${salonId}`,
  barbers: (salonId: string) => `barbers:${salonId}`,
  barber: (barberId: string) => `barber:${barberId}`,
  transactions: (salonId: string, queryKey: string) => `txns:${salonId}:${queryKey}`,
  loans: (salonId: string) => `loans:${salonId}`,
  wallet: (salonId: string) => `wallet:${salonId}`,
  report: (salonId: string, kind: string, key: string) => `report:${salonId}:${kind}:${key}`,
};