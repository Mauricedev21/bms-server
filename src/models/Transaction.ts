import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';
import { env } from '../config/env';

/**
 * A transaction is a financial event where a barber received money from a
 * customer. The original total, PLUS the automatically calculated manager share
 * (60%) and barber share (40%), are all preserved so historical calculations
 * never change even if business settings change later.
 */
const transactionSchema = new Schema(
  {
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    barber: { type: Schema.Types.ObjectId, ref: 'Barber', required: true, index: true },
    customerName: { type: String, trim: true, default: '' },
    service: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    totalAmount: { type: Number, required: true, min: 0.01 },
    managerShare: { type: Number, required: true },
    barberShare: { type: Number, required: true },
    managerPercent: { type: Number, required: true, default: env.MANAGER_SHARE_PERCENT },
    barberPercent: { type: Number, required: true, default: env.BARBER_SHARE_PERCENT },
    paymentMethod: {
      type: String,
      enum: ['cash', 'mobile_money', 'card', 'bank_transfer', 'other'],
      default: 'cash',
      index: true,
    },
    status: { type: String, enum: ['completed', 'voided'], default: 'completed', index: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientRefId: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

transactionSchema.index({ salon: 1, barber: 1, createdAt: -1 });
transactionSchema.index({ salon: 1, paymentMethod: 1 });
transactionSchema.index({ salon: 1, status: 1, createdAt: -1 });
transactionSchema.index({ salon: 1, createdAt: -1 });

export type TransactionDocument = InferSchemaType<typeof transactionSchema> & { _id: mongoose.Types.ObjectId };
export const Transaction: Model<TransactionDocument> = mongoose.model<TransactionDocument>('Transaction', transactionSchema);