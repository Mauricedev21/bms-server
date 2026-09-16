import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

/**
 * Archive is the 6-month data-retention store. Before old operational records
 * are cleaned from the live collections, their full payload (including the
 * original transaction amount together with manager/barber shares) is copied
 * here so historical reporting remains possible without risking the current
 * data set.
 */
const archiveSchema = new Schema(
  {
    kind: { type: String, enum: ['transaction', 'payment', 'loan', 'repayment', 'report'], required: true, index: true },
    originalId: { type: String, required: true },
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    barber: { type: Schema.Types.ObjectId, ref: 'Barber', index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    archivedAt: { type: Date, default: Date.now, index: true },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    sourceDeletedAt: { type: Date },
  },
  { timestamps: true },
);

archiveSchema.index({ salon: 1, kind: 1, archivedAt: -1 });
archiveSchema.index({ originalId: 1, kind: 1 }, { unique: true });

export type ArchiveDocument = InferSchemaType<typeof archiveSchema> & { _id: mongoose.Types.ObjectId };
export const Archive: Model<ArchiveDocument> = mongoose.model<ArchiveDocument>('Archive', archiveSchema);