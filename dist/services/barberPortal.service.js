"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.barberPortalService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const Barber_1 = require("../models/Barber");
const Transaction_1 = require("../models/Transaction");
const Payment_1 = require("../models/Payment");
const Loan_1 = require("../models/Loan");
const LoanRepayment_1 = require("../models/LoanRepayment");
const AppError_1 = require("../utils/AppError");
const tokens_1 = require("../utils/tokens");
const money_1 = require("../utils/money");
const oid_1 = require("../utils/oid");
const DUMMY_PIN_HASH = '$2a$10$WOSwsmK56kGEZn1SKF4kJuI2cC/8.WVyrh.acf8QhIWyNINHL2hx.';
exports.barberPortalService = {
    async login(phone, pin) {
        const barber = await Barber_1.Barber.findOne({ phone: phone.trim() }).select('+accessPinHash').lean();
        // Compare against a fixed dummy hash so unknown phones take the same time as known ones.
        const ok = await bcryptjs_1.default.compare(pin, barber?.accessPinHash ?? DUMMY_PIN_HASH);
        if (!barber || !ok)
            throw AppError_1.AppError.unauthorized('Invalid phone or PIN.');
        if (barber.status !== 'active')
            throw AppError_1.AppError.forbidden('This barber account is not active.');
        const token = (0, tokens_1.signToken)({ uid: '', role: 'barber', salon: String(barber.salon), barber: String(barber._id) });
        return { token, barber };
    },
    async summary(salonId, barberId) {
        const [txnAgg, paidAgg, loanAgg, fromEarningsAgg] = await Promise.all([
            Transaction_1.Transaction.aggregate([
                { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), status: 'completed' } },
                { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$totalAmount' }, barberShare: { $sum: '$barberShare' } } },
            ]),
            Payment_1.Payment.aggregate([
                { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), type: 'barber_payout', status: 'paid' } },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ]),
            Loan_1.Loan.aggregate([
                { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), status: 'active' } },
                { $group: { _id: null, total: { $sum: '$outstandingAmount' } } },
            ]),
            LoanRepayment_1.LoanRepayment.aggregate([
                { $match: { salon: (0, oid_1.oid)(salonId), barber: (0, oid_1.oid)(barberId), method: 'from_earnings' } },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ]),
        ]);
        const round2 = (n) => (0, money_1.fromCents)(Math.round(n * 100));
        const earned = round2(txnAgg[0]?.barberShare ?? 0);
        const paid = round2(paidAgg[0]?.total ?? 0);
        const repaidFromEarnings = round2(fromEarningsAgg[0]?.total ?? 0);
        return {
            transactionCount: txnAgg[0]?.count ?? 0,
            transactionVolume: round2(txnAgg[0]?.volume ?? 0),
            grossEarnings: earned,
            paidOut: paid,
            repaidFromEarnings,
            netEarnings: Math.max(0, round2(earned - paid - repaidFromEarnings)),
            outstandingLoans: round2(loanAgg[0]?.total ?? 0),
        };
    },
    async myTransactions(salonId, barberId) {
        return Transaction_1.Transaction.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).limit(100).lean();
    },
};
//# sourceMappingURL=barberPortal.service.js.map