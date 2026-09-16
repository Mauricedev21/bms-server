"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeWallet = recomputeWallet;
exports.getWallet = getWallet;
exports.refreshWallet = refreshWallet;
const Transaction_1 = require("../models/Transaction");
const Payment_1 = require("../models/Payment");
const Loan_1 = require("../models/Loan");
const LoanRepayment_1 = require("../models/LoanRepayment");
const Barber_1 = require("../models/Barber");
const Wallet_1 = require("../models/Wallet");
const cacheService_1 = require("../cache/cacheService");
const env_1 = require("../config/env");
const money_1 = require("../utils/money");
const oid_1 = require("../utils/oid");
/**
 * Recomputes ALL financial figures from the authoritative operations.
 * Runs after every financial write and is the single source the wallet card
 * and dashboard use. Never trusts cached numbers for truth.
 */
async function recomputeWallet(salonId) {
    const sid = (0, oid_1.oid)(salonId);
    const [txnAgg, payoutsAgg, loansAgg, repayAgg, fromEarningsAgg, barberCount] = await Promise.all([
        Transaction_1.Transaction.aggregate([
            { $match: { salon: sid, status: 'completed' } },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    volume: { $sum: '$totalAmount' },
                    manager: { $sum: '$managerShare' },
                    barberShare: { $sum: '$barberShare' },
                },
            },
        ]),
        Payment_1.Payment.aggregate([
            { $match: { salon: sid, type: 'barber_payout', status: 'paid' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Loan_1.Loan.aggregate([
            { $match: { salon: sid, status: 'active' } },
            { $group: { _id: null, total: { $sum: '$outstandingAmount' }, count: { $sum: 1 } } },
        ]),
        LoanRepayment_1.LoanRepayment.aggregate([
            { $match: { salon: sid } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        LoanRepayment_1.LoanRepayment.aggregate([
            { $match: { salon: sid, method: 'from_earnings' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Barber_1.Barber.countDocuments({ salon: salonId, status: 'active' }),
    ]);
    const round2 = (n) => (0, money_1.fromCents)(Math.round(n * 100));
    const row = (arr, idx) => (arr[idx] ?? null);
    const txn = row(txnAgg, 0);
    const payouts = row(payoutsAgg, 0);
    const loans = row(loansAgg, 0);
    const repay = row(repayAgg, 0);
    const fromEarnings = row(fromEarningsAgg, 0);
    const totalTransactionVolume = round2(txn?.volume ?? 0);
    const totalManagerEarnings = round2(txn?.manager ?? 0);
    const totalBarberEarnings = round2(txn?.barberShare ?? 0);
    const totalPaidToBarbers = round2(payouts?.total ?? 0);
    const totalOutstandingLoans = round2(loans?.total ?? 0);
    const totalLoanRepayments = round2(repay?.total ?? 0);
    const totalRepaidFromEarnings = round2(fromEarnings?.total ?? 0);
    const snapshot = {
        salon: salonId,
        currency: env_1.env.CURRENCY,
        totalTransactionVolume,
        totalTransactions: txn?.count ?? 0,
        totalManagerEarnings,
        totalBarberEarnings,
        activeBarbers: barberCount,
        totalMoneyReceived: totalTransactionVolume,
        totalPaidToBarbers,
        totalOutstandingLoans,
        totalLoanRepayments,
        totalRepaidFromEarnings,
        loanCount: loans?.count ?? 0,
        currentBalance: round2(totalTransactionVolume - totalPaidToBarbers),
        unpaidBarberEarnings: Math.max(0, round2(totalBarberEarnings - totalPaidToBarbers - totalRepaidFromEarnings)),
        lastComputedFrom: new Date(),
    };
    await Wallet_1.Wallet.updateOne({ salon: salonId }, {
        $set: {
            salon: salonId,
            currency: snapshot.currency,
            totalManagerEarnings: snapshot.totalManagerEarnings,
            totalBarberEarnings: snapshot.totalBarberEarnings,
            totalTransactionVolume: snapshot.totalTransactionVolume,
            totalTransactions: snapshot.totalTransactions,
            totalMoneyReceived: snapshot.totalMoneyReceived,
            totalPaidToBarbers: snapshot.totalPaidToBarbers,
            totalOutstandingLoans: snapshot.totalOutstandingLoans,
            totalLoanRepayments: snapshot.totalLoanRepayments,
            totalRepaidFromEarnings: snapshot.totalRepaidFromEarnings,
            activeBarbers: snapshot.activeBarbers,
            lastComputedFrom: snapshot.lastComputedFrom,
        },
    }, { upsert: true });
    return snapshot;
}
async function getWallet(salonId, force = false) {
    const cachedKey = cacheService_1.cacheKeys.wallet(salonId);
    if (!force) {
        const cached = await cacheService_1.cache.get(cachedKey);
        if (cached)
            return cached;
    }
    const snapshot = await recomputeWallet(salonId);
    await cacheService_1.cache.set(cachedKey, snapshot, env_1.env.CACHE_TTL_DASHBOARD);
    return snapshot;
}
async function refreshWallet(salonId) {
    await (0, cacheService_1.invalidateSalon)(salonId);
    return recomputeWallet(salonId);
}
//# sourceMappingURL=wallet.service.js.map