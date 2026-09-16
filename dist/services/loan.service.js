"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loanPopulateQuery = loanPopulateQuery;
exports.listLoans = listLoans;
exports.createLoan = createLoan;
exports.getLoan = getLoan;
exports.recordRepayment = recordRepayment;
exports.deductLoanFromEarnings = deductLoanFromEarnings;
exports.loanRepaidFromEarnings = loanRepaidFromEarnings;
const Loan_1 = require("../models/Loan");
const LoanRepayment_1 = require("../models/LoanRepayment");
const Barber_1 = require("../models/Barber");
const AppError_1 = require("../utils/AppError");
const money_1 = require("../utils/money");
const cacheService_1 = require("../cache/cacheService");
const audit_service_1 = require("./audit.service");
const wallet_service_1 = require("./wallet.service");
const oid_1 = require("../utils/oid");
function loanPopulateQuery() {
    return Loan_1.Loan.find();
}
async function listLoans(salonId, filters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const query = { salon: salonId };
    if (filters.barber) {
        const barber = await Barber_1.Barber.findOne({ _id: filters.barber, salon: salonId }).lean();
        if (!barber)
            throw AppError_1.AppError.badRequest('Barber not found in your salon.');
        query.barber = filters.barber;
    }
    if (filters.status)
        query.status = filters.status;
    const [items, total, repaidAgg] = await Promise.all([
        Loan_1.Loan.find(query).sort({ createdAt: -1 }).populate('barber', 'name phone').lean(),
        Loan_1.Loan.countDocuments(query),
        LoanRepayment_1.LoanRepayment.aggregate([
            { $match: { salon: (0, oid_1.oid)(salonId) } },
            { $group: { _id: '$loan', total: { $sum: '$amount' } } },
        ]),
    ]);
    const repaidMap = new Map(repaidAgg.map((r) => [String(r._id), (0, money_1.fromCents)(Math.round(r.total * 100))]));
    const withRepaid = items.map((l) => ({ ...l, totalRepaid: repaidMap.get(String(l._id)) ?? 0 }));
    return { items: withRepaid, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
async function createLoan(salonId, barberId, amount, reason, createdBy) {
    if (!(0, money_1.isValidAmount)(amount))
        throw AppError_1.AppError.badRequest('Invalid loan amount.');
    const barber = await Barber_1.Barber.findOne({ _id: barberId, salon: salonId }).lean();
    if (!barber)
        throw AppError_1.AppError.badRequest('You can only give loans to barbers in your own salon.');
    if (barber.status !== 'active')
        throw AppError_1.AppError.badRequest('This barber is not active.');
    const normalized = (0, money_1.normalizeAmount)(amount);
    const loan = await Loan_1.Loan.create({
        salon: salonId,
        barber: barberId,
        amount: normalized,
        outstandingAmount: normalized,
        reason: reason?.trim() ?? '',
        status: 'active',
        createdBy,
    });
    (0, audit_service_1.auditTrail)(null, {
        action: 'loan.created',
        entity: 'Loan',
        entityId: loan._id,
        salon: salonId,
        after: { amount: normalized, barber: barberId },
    });
    await (0, cacheService_1.invalidateSalon)(salonId);
    await (0, wallet_service_1.refreshWallet)(salonId);
    return loan;
}
async function getLoan(salonId, loanId) {
    const loan = await Loan_1.Loan.findOne({ _id: loanId, salon: salonId }).populate('barber', 'name phone').lean();
    if (!loan)
        throw AppError_1.AppError.notFound('Loan not found in your salon.');
    const repayments = await LoanRepayment_1.LoanRepayment.find({ loan: loanId }).sort({ createdAt: -1 }).lean();
    return { loan, repayments };
}
async function recordRepayment(salonId, loanId, amount, method, remark, recordedBy) {
    if (!(0, money_1.isValidAmount)(amount))
        throw AppError_1.AppError.badRequest('Invalid repayment amount.');
    const loan = await Loan_1.Loan.findOne({ _id: loanId, salon: salonId });
    if (!loan)
        throw AppError_1.AppError.notFound('Loan not found in your salon.');
    if (loan.outstandingAmount <= 0)
        throw AppError_1.AppError.badRequest('This loan is already fully settled.');
    const normalized = (0, money_1.normalizeAmount)(amount);
    if (normalized > loan.outstandingAmount + 1e-6) {
        throw AppError_1.AppError.badRequest(`Repayment exceeds the outstanding balance (remaining: ${loan.outstandingAmount.toLocaleString()}).`);
    }
    const repayment = await LoanRepayment_1.LoanRepayment.create({
        salon: salonId,
        loan: loanId,
        barber: loan.barber,
        amount: normalized,
        method,
        remark: remark?.trim() ?? '',
        recordedBy,
    });
    loan.outstandingAmount = (0, money_1.fromCents)(Math.round((loan.outstandingAmount - normalized) * 100));
    if (loan.outstandingAmount <= 0) {
        loan.outstandingAmount = 0;
        loan.status = 'settled';
    }
    await loan.save();
    (0, audit_service_1.auditTrail)(null, {
        action: 'loan.repayment',
        entity: 'Loan',
        entityId: loanId,
        salon: salonId,
        before: { outstandingAmount: loan.outstandingAmount + normalized },
        after: { outstandingAmount: loan.outstandingAmount, repayment: normalized },
    });
    await (0, cacheService_1.invalidateSalon)(salonId);
    await (0, wallet_service_1.refreshWallet)(salonId);
    return { loan, repayment };
}
/**
 * Automatically settle outstanding loans from a barber's earnings, oldest loans
 * first, until `amount` is fully consumed. Creates `from_earnings` LoanRepayment
 * records and returns the total actually deducted. Used by the payout flow so a
 * barber's loans are always cleared before any cash is handed over.
 */
async function deductLoanFromEarnings(salonId, barberId, amount, recordedBy) {
    let remaining = (0, money_1.normalizeAmount)(amount);
    let deducted = 0;
    if (remaining <= 0)
        return 0;
    const activeLoans = await Loan_1.Loan.find({ salon: salonId, barber: barberId, status: 'active' }).sort({ createdAt: 1 }).exec();
    for (const loan of activeLoans) {
        if (remaining <= 0)
            break;
        const take = Math.min(remaining, loan.outstandingAmount);
        if (take <= 0)
            continue;
        await LoanRepayment_1.LoanRepayment.create({
            salon: salonId,
            loan: loan._id,
            barber: barberId,
            amount: take,
            method: 'from_earnings',
            remark: 'Automatic loan deduction from barber payment',
            recordedBy,
        });
        loan.outstandingAmount = (0, money_1.fromCents)(Math.round((loan.outstandingAmount - take) * 100));
        if (loan.outstandingAmount <= 0) {
            loan.outstandingAmount = 0;
            loan.status = 'settled';
        }
        await loan.save();
        remaining = (0, money_1.fromCents)(Math.round((remaining - take) * 100));
        deducted = (0, money_1.fromCents)(Math.round((deducted + take) * 100));
    }
    return deducted;
}
/** Total amount of loan repayments already taken out of a barber's earnings. */
async function loanRepaidFromEarnings(salonId, barberId) {
    const agg = await LoanRepayment_1.LoanRepayment.aggregate([
        { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), method: 'from_earnings' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return agg[0]?.total ?? 0;
}
//# sourceMappingURL=loan.service.js.map