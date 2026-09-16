import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

const reportSchema = new Schema(
  {
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    reportType: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'six_month', 'annual', 'custom'],
      required: true,
    },
    title: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    totals: {
      transactionVolume: { type: Number, default: 0 },
      managerEarnings: { type: Number, default: 0 },
      barberEarnings: { type: Number, default: 0 },
      transactionCount: { type: Number, default: 0 },
      loanRepaymentsReceived: { type: Number, default: 0 },
      outstandingLoans: { type: Number, default: 0 },
    },
    perBarber: [
      {
        barber: { type: Schema.Types.ObjectId, ref: 'Barber' },
        name: { type: String },
        transactionCount: { type: Number, default: 0 },
        transactionVolume: { type: Number, default: 0 },
        managerShare: { type: Number, default: 0 },
        barberShare: { type: Number, default: 0 },
      },
    ],
    loansIssued: { type: Number, default: 0 },
    loansRepaid: { type: Number, default: 0 },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    generatedAt: { type: Date, default: Date.now },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reportSchema.index({ salon: 1, reportType: 1, periodStart: -1 });

export type ReportDocument = InferSchemaType<typeof reportSchema> & { _id: mongoose.Types.ObjectId };
export const Report: Model<ReportDocument> = mongoose.model<ReportDocument>('Report', reportSchema);