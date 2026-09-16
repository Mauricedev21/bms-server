"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditTrail = auditTrail;
const AuditLog_1 = require("../models/AuditLog");
const logger_1 = require("../utils/logger");
function auditTrail(req, input) {
    const actor = req?.reqUser;
    const ip = req?.ip || '';
    const record = new AuditLog_1.AuditLog({
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
    record.save().catch((err) => logger_1.logger.warn('[audit] write failed', err.message));
}
//# sourceMappingURL=audit.service.js.map