import type { Request } from 'express';
import { AuditLog } from '../models/AuditLog';
import { logger } from '../utils/logger';

export interface AuditInput {
  action: string;
  entity?: string;
  entityId?: unknown;
  salon?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}

export function auditTrail(req: Request | null, input: AuditInput): void {
  const actor = req?.reqUser as { _id?: unknown; role?: string } | undefined;
  const ip = req?.ip || '';
  const record = new AuditLog({
    actor: actor && actor._id ? actor._id : undefined,
    actorRole: input.meta?.actorRole ?? (actor?.role ?? 'system'),
    action: input.action,
    entity: input.entity ?? '',
    entityId: input.entityId ?? null,
    salon: input.salon ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta ?? {},
    ip,
  });
  record.save().catch((err) => logger.warn('[audit] write failed', err.message));
}