import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

const loanRepaymentSchema = new Schema(
  {
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    loan: { type: Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    barber: { type: Schema.Types.ObjectId, ref: 'Barber', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['cash', 'mobile_money', 'card', 'bank_transfer', 'from_earnings', 'other'], default: 'cash' },
    remark: { type: String, trim: true, default: '' },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

loanRepaymentSchema.index({ salon: 1, loan: 1, createdAt: 1 });

export type LoanRepaymentDocument = InferSchemaType<typeof loanRepaymentSchema> & {
  _id: mongoose.Types.ObjectId;
};
export const LoanRepayment: Model<LoanRepaymentDocument> = mongoose.model<LoanRepaymentDocument>(
  'LoanRepayment',
  loanRepaymentSchema,
);