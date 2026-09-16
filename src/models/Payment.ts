import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

/**
 * Payments record two distinct money events:
 *  - customer_payment: the money a customer paid into a barber transaction.
 *  - barber_payout:     the manager paying a barber part of their 40% share.
 */
const paymentSchema = new Schema(
  {
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    barber: { type: Schema.Types.ObjectId, ref: 'Barber', index: true },
    type: { type: String, enum: ['customer_payment', 'barber_payout'], default: 'customer_payment', index: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'mobile_money', 'card', 'bank_transfer', 'other'], default: 'cash' },
    status: { type: String, enum: ['paid', 'refunded'], default: 'paid' },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

paymentSchema.index({ salon: 1, type: 1, createdAt: -1 });

export type PaymentDocument = InferSchemaType<typeof paymentSchema> & { _id: mongoose.Types.ObjectId };
export const Payment: Model<PaymentDocument> = mongoose.model<PaymentDocument>('Payment', paymentSchema);