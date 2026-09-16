import mongoose from 'mongoose';
import { env, isProd } from './env';

export async function connectDB(): Promise<void> {
  mongoose.set('strictQuery', true);
  try {
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