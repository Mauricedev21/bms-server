import Redis from 'ioredis';
import { env } from './env';

let client: Redis | null = null;
let redisAvailable = false;

export function initRedis(): Redis | null {
  if (!env.REDIS_URL) {
    console.log('[redis] REDIS_URL not set - using in-memory cache fallback');
    return null;
  }
  try {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on('connect', () => {
      redisAvailable = true;
      console.log('[redis] connected');
    });
    client.on('error', (err) => {
      if (!redisAvailable) console.warn('[redis] unavailable:', err.message);
      redisAvailable = false;
    });
    // Attempt connection but do not crash the app if redis is down.
    client.connect().catch((err) => {
      console.warn('[redis] connect attempt failed:', err.message);
    });
  } catch (err) {
    console.warn('[redis] init failed:', (err as Error).message);
    client = null;
  }
  return client;
}

export function getRedis(): Redis | null {
  return redisAvailable ? client : null;
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}