"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRedis = initRedis;
exports.getRedis = getRedis;
exports.isRedisAvailable = isRedisAvailable;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
let client = null;
let redisAvailable = false;
function initRedis() {
    if (!env_1.env.REDIS_URL) {
        console.log('[redis] REDIS_URL not set - using in-memory cache fallback');
        return null;
    }
    try {
        client = new ioredis_1.default(env_1.env.REDIS_URL, {
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
            if (!redisAvailable)
                console.warn('[redis] unavailable:', err.message);
            redisAvailable = false;
        });
        // Attempt connection but do not crash the app if redis is down.
        client.connect().catch((err) => {
            console.warn('[redis] connect attempt failed:', err.message);
        });
    }
    catch (err) {
        console.warn('[redis] init failed:', err.message);
        client = null;
    }
    return client;
}
function getRedis() {
    return redisAvailable ? client : null;
}
function isRedisAvailable() {
    return redisAvailable;
}
//# sourceMappingURL=redis.js.map