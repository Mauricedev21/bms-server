import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

const barberSchema = new Schema(
  {
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    gender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
    role: { type: String, default: 'Barber' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    accessPinHash: { type: String, select: false, default: null },
    specializations: { type: [String], default: [] },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

barberSchema.index({ salon: 1, phone: 1 }, { unique: true });
barberSchema.index({ salon: 1, status: 1 });

export type BarberDocument = InferSchemaType<typeof barberSchema> & { _id: mongoose.Types.ObjectId };
export const Barber: Model<BarberDocument> = mongoose.model<BarberDocument>('Barber', barberSchema);