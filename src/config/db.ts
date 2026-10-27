import mongoose from 'mongoose';
import { env, isProd } from './env';

/**
 * Fail fast with an ACTIONABLE message when MONGODB_URI is unusable.
 * Without this check, an empty value surfaces from the driver as the opaque
 * "Invalid scheme, expected connection string…" error, which made production
 * deploy crashes hard to diagnose. Security: the URI value itself is never
 * included in any message or log.
 */
function assertUsableMongoUri(uri: string): void {
  if (!uri) {
    throw new Error('MONGODB_URI is empty or missing — set it in this environment (the value itself is never logged)');
  }
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_URI must start with mongodb+srv:// or mongodb:// (the value itself is never logged)');
  }
}

export async function connectDB(): Promise<void> {
  mongoose.set('strictQuery', true);
  try {
    assertUsableMongoUri(env.MONGODB_URI);
    const conn = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: isProd ? 15000 : 8000,
    });
    console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (err) {
    console.error('[db] MongoDB connection failed:', (err as Error).message);
    throw err;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}