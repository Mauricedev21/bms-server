import mongoose, { Schema, type Model, type InferSchemaType } from 'mongoose';

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'account_expiring',
        'account_expired',
        'account_activated',
        'account_deactivated',
        'new_registration',
        'system',
        'loan',
        'transaction',
      ],
      default: 'system',
    },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    data: { type: Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export type NotificationDocument = InferSchemaType<typeof notificationSchema> & { _id: mongoose.Types.ObjectId };
export const Notification: Model<NotificationDocument> = mongoose.model<NotificationDocument>(
  'Notification',
  notificationSchema,
);