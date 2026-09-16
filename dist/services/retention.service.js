"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRetention = runRetention;
const dayjs_1 = __importDefault(require("dayjs"));
const Transaction_1 = require("../models/Transaction");
const Payment_1 = require("../models/Payment");
const Loan_1 = require("../models/Loan");
const LoanRepayment_1 = require("../models/LoanRepayment");
const Report_1 = require("../models/Report");
const Archive_1 = require("../models/Archive");
const env_1 = require("../config/env");
const cacheService_1 = require("../cache/cacheService");
const audit_service_1 = require("./audit.service");
const logger_1 = require("../utils/logger");
/**
 * Six-month data-retention/archiving. Never blindly deletes: old operational
 * records are first copied (full payload, including the original transaction
 * amount AND both shares) into the Archive collection, then removed from the
 * live collections. Active loans are never touched. Idempotent via a unique
 * (originalId, kind) index.
 */
async function runRetention(options = {}) {
    const months = options.months ?? env_1.env.RETENTION_MONTHS;
    const cut = (0, dayjs_1.default)().subtract(months, 'month').toDate();
    const salonFilter = options.salonId ? { salon: options.salonId } : {};
    const actor = options.actor;
    const result = {
        months,
        archived: { transactions: 0, payments: 0, loans: 0, repayments: 0, reports: 0 },
        cleanedFrom: cut,
    };
    const counterKey = {
        transaction: 'transactions',
        payment: 'payments',
        loan: 'loans',
        repayment: 'repayments',
        report: 'reports',
    };
    const archiveBatch = async (kind, docs, del) => {
        if (!docs.length)
            return;
        let inserted = 0;
        for (const doc of docs) {
            try {
                await Archive_1.Archive.create({
                    kind,
                    originalId: String(doc._id),
                    salon: salonFilter.salon ?? doc.salon ?? undefined,
                    barber: doc.barber ?? undefined,
                    payload: typeof doc.toObject === 'function' ? doc.toObject() : doc,
                    archivedAt: new Date(),
                    archivedBy: actor ? actor : undefined,
                });
                inserted++;
            }
            catch (err) {
                if (err.code !== 11000)
                    throw err; // skip duplicates
            }
        }
        await del?.();
        result.archived[counterKey[kind]] += inserted;
    };
    // 1. Transactions older than the retention window (with full split preserved)
    const salonsWithOldTxns = await Transaction_1.Transaction.distinct('salon', {
        status: 'completed',
        createdAt: { $lt: cut },
        ...salonFilter,
    });
    for (const s of salonsWithOldTxns) {
        const docs = await Transaction_1.Transaction.find({ salon: s, status: 'completed', createdAt: { $lt: cut } })
            .select('+clientRefId')
            .limit(500);
        if (docs.length) {
            await archiveBatch('transaction', docs, async () => {
                await Transaction_1.Transaction.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
            });
            await (0, cacheService_1.invalidateSalon)(String(s));
        }
    }
    // 2. Customer payments older than the window (associated with archived txns)
    const oldPayDocs = await Payment_1.Payment.find({ type: 'customer_payment', createdAt: { $lt: cut }, ...salonFilter }).limit(500);
    if (oldPayDocs.length) {
        await archiveBatch('payment', oldPayDocs, async () => {
            await Payment_1.Payment.deleteMany({ _id: { $in: oldPayDocs.map((d) => d._id) } });
        });
    }
    // 3. Settled loans older than the window + their repayments (active loans untouched)
    const oldLoans = await Loan_1.Loan.find({ status: 'settled', updatedAt: { $lt: cut }, ...salonFilter }).limit(500);
    if (oldLoans.length) {
        const loanIds = oldLoans.map((l) => l._id);
        const reps = await LoanRepayment_1.LoanRepayment.find({ loan: { $in: loanIds } });
        if (reps.length) {
            await archiveBatch('repayment', reps, async () => {
                await LoanRepayment_1.LoanRepayment.deleteMany({ _id: { $in: reps.map((d) => d._id) } });
            });
        }
        await archiveBatch('loan', oldLoans, async () => {
            await Loan_1.Loan.deleteMany({ _id: { $in: loanIds } });
        });
    }
    // 4. Stored reports older than the window
    const oldReports = await Report_1.Report.find({ createdAt: { $lt: cut }, ...salonFilter }).limit(500);
    if (oldReports.length) {
        await archiveBatch('report', oldReports, async () => {
            await Report_1.Report.deleteMany({ _id: { $in: oldReports.map((d) => d._id) } });
        });
    }
    (0, audit_service_1.auditTrail)(null, {
        action: 'retention.run',
        entity: 'Archive',
        salon: salonFilter.salon ?? null,
        after: result,
        meta: { actorRole: 'system' },
    });
    logger_1.logger.info(`[retention] archived ${JSON.stringify(result.archived)} records older than ${months} months`);
    return result;
}
//# sourceMappingURL=retention.service.js.map