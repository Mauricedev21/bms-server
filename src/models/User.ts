import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

const userSchema = new Schema(
  {
    username: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    fullName: { type: String, trim: true, default: '' },
    phone: { type: String, required: true, trim: true, unique: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['manager', 'admin'], default: 'manager', index: true },
    status: { type: String, enum: ['active', 'suspended', 'expired'], default: 'active', index: true },
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', index: true },
    periodDays: { type: Number, default: env.ACCOUNT_PERIOD_DAYS },
    subscriptionStart: { type: Date },
    subscriptionEnd: { type: Date, index: true },
    lastActiveAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.pre('save', async function (next) {
  if (this.isModified('passwordHash')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, env.BCRYPT_ROUNDS);
  }
  if (this.isNew) {
    this.subscriptionStart = new Date();
    this.subscriptionEnd = new Date(Date.now() + this.periodDays * 24 * 60 * 60 * 1000);
  }
  next();
});

userSchema.methods.comparePassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.subscriptionStatus = function (): { state: 'active' | 'expiring' | 'expired'; daysLeft: number } {
  const now = Date.now();
  const end = this.subscriptionEnd ? this.subscriptionEnd.getTime() : now;
  const daysLeft = Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
  const state: 'active' | 'expiring' | 'expired' =
    now > end ? 'expired' : daysLeft <= env.NOTIFICATION_EXPIRY_DAYS ? 'expiring' : 'active';
  return { state, daysLeft };
};

export type UserDocument = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
  comparePassword(plain: string): Promise<boolean>;
  subscriptionStatus(): { state: 'active' | 'expiring' | 'expired'; daysLeft: number };
};

export const User: Model<UserDocument> = mongoose.model<UserDocument>('User', userSchema);