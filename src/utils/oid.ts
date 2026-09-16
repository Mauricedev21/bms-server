import mongoose from 'mongoose';

/** Cast a hex id string to ObjectId for use inside aggregation pipelines. */
export const oid = (s: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(s);