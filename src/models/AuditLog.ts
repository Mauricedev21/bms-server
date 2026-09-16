import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: { type: String, enum: ['manager', 'admin', 'barber', 'system'], default: 'system' },
    action: { type: String, required: true, index: true },
    entity: { type: String, default: '' },
    entityId: { type: Schema.Types.Mixed, default: null },
    salon: { type: Schema.Types.ObjectId, ref: 'Salon', index: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ salon: 1, createdAt: -1 });

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema> & { _id: mongoose.Types.ObjectId };
export const AuditLog: Model<AuditLogDocument> = mongoose.model<AuditLogDocument>('AuditLog', auditLogSchema);