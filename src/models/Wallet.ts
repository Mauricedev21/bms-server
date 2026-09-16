import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

/**
 * Wallet / financial snapshot for a salon. These numbers are derived from the
 * authoritative operations (transactions/loans/repayments) by walletService and
 * refreshed on every financial change. They are cached reads, never a source
 * of truth by themselves.
 */
const walletSchema = new Schema(
  {
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, unique: true, index: true },
    currency: { type: String, default: 'RWF' },
    totalManagerEarnings: { type: Number, default: 0 },
    totalBarberEarnings: { type: Number, default: 0 },
    totalTransactionVolume: { type: Number, default: 0 },
    totalTransactions: { type: Number, default: 0 },
    totalMoneyReceived: { type: Number, default: 0 },
    totalPaidToBarbers: { type: Number, default: 0 },
    totalOutstandingLoans: { type: Number, default: 0 },
    totalLoanRepayments: { type: Number, default: 0 },
    activeBarbers: { type: Number, default: 0 },
    lastComputedFrom: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type WalletDocument = InferSchemaType<typeof walletSchema> & { _id: mongoose.Types.ObjectId };
export const Wallet: Model<WalletDocument> = mongoose.model<WalletDocument>('Wallet', walletSchema);