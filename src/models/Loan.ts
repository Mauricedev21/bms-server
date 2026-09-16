import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

/**
 * Loan given by the salon/manager to a barber. Loans are kept strictly separate
 * from normal barber 40% earnings unless explicitly included in a calculation
 * (e.g. the wallet module shows both side by side but never merges them
 * silently in the transaction share logic).
 */
const loanSchema = new Schema(
  {
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    barber: { type: Schema.Types.ObjectId, ref: 'Barber', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    outstandingAmount: { type: Number, required: true },
    reason: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'settled'], default: 'active', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

loanSchema.index({ salon: 1, status: 1, createdAt: -1 });

export type LoanDocument = InferSchemaType<typeof loanSchema> & { _id: mongoose.Types.ObjectId };
export const Loan: Model<LoanDocument> = mongoose.model<LoanDocument>('Loan', loanSchema);