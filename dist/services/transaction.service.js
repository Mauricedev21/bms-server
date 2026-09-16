"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createTransaction = createTransaction;
exports.listTransactions = listTransactions;
exports.getTransaction = getTransaction;
exports.voidTransaction = voidTransaction;
exports.recordBarberPayout = recordBarberPayout;
exports.recentTransactionsForCache = recentTransactionsForCache;
const Transaction_1 = require("../models/Transaction");
const mongoose_1 = require("mongoose");
const Payment_1 = require("../models/Payment");
const Barber_1 = require("../models/Barber");
const Loan_1 = require("../models/Loan");
const AppError_1 = require("../utils/AppError");
const money_1 = require("../utils/money");
const audit_service_1 = require("./audit.service");
const wallet_service_1 = require("./wallet.service");
const loan_service_1 = require("./loan.service");
const cacheService_1 = require("../cache/cacheService");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
Object.defineProperty(exports, "logger", { enumerable: true, get: function () { return logger_1.logger; } });
const oid_1 = require("../utils/oid");
/**
 * The ONLY place a customer transaction is created. The 60/40 split is computed
 * here on the backend — the frontend only supplies the total; it can never
 * dictate manager/barber shares.
 */
async function createTransaction(input) {
    if (!(0, money_1.isValidAmount)(input.totalAmount)) {
        throw AppError_1.AppError.badRequest('Invalid total amount provided.');
    }
    const barber = await Barber_1.Barber.findOne({ _id: input.barberId, salon: input.salonId }).lean();
    if (!barber)
        throw AppError_1.AppError.badRequest('You can only record transactions for barbers in your own salon.');
    if (barber.status !== 'active')
        throw AppError_1.AppError.badRequest('This barber is not active.');
    const total = (0, money_1.normalizeAmount)(input.totalAmount);
    // Service auto-fills from the barber's specialization when not supplied. The
    // manager only records the total; the system classifies the service.
    const service = input.service?.trim() || (barber.specializations?.[0] ?? '');
    // ── Duplicate-submission protection ─────────────────────────────────────
    // 1) Strong: clientRefId is globally unique.
    const existingByRef = await Transaction_1.Transaction.findOne({ clientRefId: input.clientRefId }).lean();
    if (existingByRef) {
        throw AppError_1.AppError.conflict('This transaction was already recorded (duplicate submission).', {
            code: 'DUPLICATE_REF',
        });
    }
    // 2) Defensive: identical amount to the same barber within 2 minutes.
    const recent = await Transaction_1.Transaction.findOne({
        salon: input.salonId,
        barber: input.barberId,
        totalAmount: total,
        createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) },
    }).lean();
    if (recent) {
        throw AppError_1.AppError.conflict('An identical transaction for this barber was recorded moments ago. Review before submitting.', {
            code: 'DUPLICATE_RECENT',
            recentId: recent._id,
        });
    }
    const split = (0, money_1.calculateShare)(total);
    const txn = await Transaction_1.Transaction.create({
        salon: input.salonId,
        barber: input.barberId,
        customerName: input.customerName?.trim() ?? '',
        service,
        description: input.description?.trim() ?? '',
        totalAmount: total,
        managerShare: split.managerShare,
        barberShare: split.barberShare,
        managerPercent: split.managerPercent,
        barberPercent: split.barberPercent,
        paymentMethod: input.paymentMethod,
        status: 'completed',
        recordedBy: input.recordedBy,
        clientRefId: input.clientRefId,
    });
    await Payment_1.Payment.create({
        salon: input.salonId,
        transaction: txn._id,
        barber: input.barberId,
        type: 'customer_payment',
        amount: total,
        method: input.paymentMethod,
        status: 'paid',
        receivedBy: input.recordedBy,
        note: input.description?.trim() ?? '',
    });
    (0, audit_service_1.auditTrail)(null, {
        action: 'transaction.created',
        entity: 'Transaction',
        entityId: txn._id,
        salon: input.salonId,
        after: {
            totalAmount: total,
            managerShare: split.managerShare,
            barberShare: split.barberShare,
            barber: input.barberId,
        },
        meta: { actorId: undefined, actorRole: 'manager' },
    });
    await (0, wallet_service_1.refreshWallet)(input.salonId);
    const populated = await Transaction_1.Transaction.findById(txn._id).populate('barber', 'name phone').lean();
    return populated;
}
async function listTransactions(filters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const query = { salon: filters.salonId };
    if (filters.barber) {
        const barber = await Barber_1.Barber.findOne({ _id: filters.barber, salon: filters.salonId }).lean();
        if (!barber)
            throw AppError_1.AppError.badRequest('Barber not found in your salon.');
        query.barber = filters.barber;
    }
    if (filters.paymentMethod)
        query.paymentMethod = filters.paymentMethod;
    if (filters.status)
        query.status = filters.status;
    if (filters.startDate || filters.endDate) {
        const range = {};
        if (filters.startDate)
            range.$gte = new Date(filters.startDate);
        if (filters.endDate) {
            const end = new Date(filters.endDate);
            end.setHours(23, 59, 59, 999);
            range.$lte = end;
        }
        query.createdAt = range;
    }
    if (filters.search) {
        query.$or = [
            { service: { $regex: filters.search, $options: 'i' } },
            { description: { $regex: filters.search, $options: 'i' } },
            { customerName: { $regex: filters.search, $options: 'i' } },
        ];
    }
    const cacheKey = cacheService_1.cacheKeys.transactions(filters.salonId, JSON.stringify(query) + `:p${page}:l${limit}`);
    const cached = await cacheService_1.cache.get(cacheKey);
    if (cached) {
        const summary = await computeSummary(query);
        return { ...cached, summary };
    }
    const [items, total] = await Promise.all([
        Transaction_1.Transaction.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('barber', 'name phone').lean(),
        Transaction_1.Transaction.countDocuments(query),
    ]);
    const result = {
        items: items,
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        summary: await computeSummary(query),
    };
    await cacheService_1.cache.set(cacheKey, { items: result.items, total, page, pages: result.pages }, env_1.env.CACHE_TTL_LIST);
    return result;
}
async function computeSummary(query) {
    const aggQuery = { ...query };
    if (aggQuery.salon)
        aggQuery.salon = new mongoose_1.Types.ObjectId(String(aggQuery.salon));
    if (aggQuery.barber)
        aggQuery.barber = new mongoose_1.Types.ObjectId(String(aggQuery.barber));
    const agg = await Transaction_1.Transaction.aggregate([
        { $match: aggQuery },
        {
            $group: {
                _id: null,
                volume: { $sum: '$totalAmount' },
                manager: { $sum: '$managerShare' },
                barberShare: { $sum: '$barberShare' },
                count: { $sum: 1 },
            },
        },
    ]);
    const r = agg[0];
    return {
        volume: r ? (0, money_1.fromCents)(Math.round(r.volume * 100)) : 0,
        managerShare: r ? (0, money_1.fromCents)(Math.round(r.manager * 100)) : 0,
        barberShare: r ? (0, money_1.fromCents)(Math.round(r.barberShare * 100)) : 0,
        count: r?.count ?? 0,
    };
}
async function getTransaction(salonId, txnId) {
    const txn = await Transaction_1.Transaction.findOne({ _id: txnId, salon: salonId }).populate('barber', 'name phone').lean();
    if (!txn)
        throw AppError_1.AppError.notFound('Transaction not found in your salon.');
    return txn;
}
/** Void a transaction (soft). Counts of the original amount remain in AuditLog */
async function voidTransaction(salonId, txnId, reason) {
    const txn = await Transaction_1.Transaction.findOne({ _id: txnId, salon: salonId });
    if (!txn)
        throw AppError_1.AppError.notFound('Transaction not found in your salon.');
    if (txn.status === 'voided')
        throw AppError_1.AppError.badRequest('Transaction already voided.');
    if (!reason.trim())
        throw AppError_1.AppError.badRequest('A reason is required to void a transaction.');
    txn.status = 'voided';
    await txn.save();
    await Payment_1.Payment.updateOne({ transaction: txn._id }, { $set: { status: 'refunded' } });
    (0, audit_service_1.auditTrail)(null, {
        action: 'transaction.voided',
        entity: 'Transaction',
        entityId: txn._id,
        salon: salonId,
        before: { status: 'completed' },
        after: { status: 'voided', reason },
    });
    await (0, cacheService_1.invalidateSalon)(salonId);
    await (0, wallet_service_1.refreshWallet)(salonId);
    return txn.toObject();
}
/**
 * Record a manager → barber payout from the barber's accumulated 40% share.
 * Outstanding loans are deducted automatically BEFORE the cash is handed over:
 * the deduction is recorded as `from_earnings` loan repayments (oldest loans
 * first) and the difference is paid out. Amount is optional — when omitted the
 * FULL available earnings are settled so the barber restarts at zero.
 */
async function recordBarberPayout(salonId, barberId, amount, method, recordedBy) {
    const barber = await Barber_1.Barber.findOne({ _id: barberId, salon: salonId }).lean();
    if (!barber)
        throw AppError_1.AppError.badRequest('Barber not found in your salon.');
    if (barber.status !== 'active')
        throw AppError_1.AppError.badRequest('This barber is not active.');
    const [barberShareAgg, payoutAgg, outstandingAgg] = await Promise.all([
        Transaction_1.Transaction.aggregate([
            { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$barberShare' } } },
        ]),
        Payment_1.Payment.aggregate([
            { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), type: 'barber_payout', status: 'paid' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Loan_1.Loan.aggregate([
            { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), status: 'active' } },
            { $group: { _id: null, total: { $sum: '$outstandingAmount' } } },
        ]),
    ]);
    const earned = barberShareAgg[0]?.total ?? 0;
    const alreadyPaid = payoutAgg[0]?.total ?? 0;
    const repaidFromEarnings = await (0, loan_service_1.loanRepaidFromEarnings)(salonId, barberId);
    const available = Math.max(0, (0, money_1.fromCents)(Math.round((earned - alreadyPaid - repaidFromEarnings) * 100)));
    const outstandingLoans = (0, money_1.fromCents)(Math.round((outstandingAgg[0]?.total ?? 0) * 100));
    const fullSettlement = amount === undefined || amount === null || !Number.isFinite(amount);
    const normalized = fullSettlement ? available : (0, money_1.normalizeAmount)(amount);
    if (normalized <= 0)
        throw AppError_1.AppError.badRequest('This barber has no available earnings to pay out.');
    if (normalized > available + 1e-6) {
        throw AppError_1.AppError.badRequest(`Payout exceeds this barber's available earnings (available: ${env_1.env.CURRENCY} ${available.toLocaleString()}).`);
    }
    const loanDeduction = Math.min(outstandingLoans, normalized);
    const netPayout = (0, money_1.fromCents)(Math.round((normalized - loanDeduction) * 100));
    let deducted = 0;
    if (loanDeduction > 0) {
        deducted = await (0, loan_service_1.deductLoanFromEarnings)(salonId, barberId, loanDeduction, recordedBy);
    }
    let payment = null;
    if (netPayout > 0) {
        payment = await Payment_1.Payment.create({
            salon: salonId,
            barber: barberId,
            type: 'barber_payout',
            amount: netPayout,
            method,
            status: 'paid',
            receivedBy: recordedBy,
            note: 'Barber earnings payout',
        });
    }
    (0, audit_service_1.auditTrail)(null, {
        action: 'barber.payout',
        entity: 'Barber',
        entityId: barberId,
        salon: salonId,
        after: {
            gross: normalized,
            loanDeduction: deducted,
            netPayout,
            outstandingLoans,
        },
    });
    await (0, wallet_service_1.refreshWallet)(salonId);
    return {
        payment,
        breakdown: {
            earned: (0, money_1.fromCents)(Math.round(earned * 100)),
            alreadyPaid: (0, money_1.fromCents)(Math.round(alreadyPaid * 100)),
            repaidFromEarnings,
            availableEarnings: available,
            outstandingLoans,
            loanDeduction: deducted,
            netPayout,
        },
    };
}
function recentTransactionsForCache(salonId, limit) {
    return cacheService_1.cacheKeys.transactions(salonId, `recent:${limit}`);
}
//# sourceMappingURL=transaction.service.js.map