import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';
import { env } from '../config/env';

const salonSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    website: { type: String, trim: true, default: '' },
    currency: { type: String, default: env.CURRENCY },
    managerSharePercent: { type: Number, default: env.MANAGER_SHARE_PERCENT, min: 0, max: 100 },
    barberSharePercent: { type: Number, default: env.BARBER_SHARE_PERCENT, min: 0, max: 100 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    logoColor: { type: String, default: '#E11D48' },
  },
  { timestamps: true },
);

export type SalonDocument = InferSchemaType<typeof salonSchema> & { _id: mongoose.Types.ObjectId };
export const Salon: Model<SalonDocument> = mongoose.model<SalonDocument>('Salon', salonSchema);