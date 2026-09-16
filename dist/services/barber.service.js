"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBarbers = listBarbers;
exports.getBarber = getBarber;
exports.createBarber = createBarber;
exports.updateBarber = updateBarber;
exports.setBarberPin = setBarberPin;
exports.deleteBarber = deleteBarber;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const Barber_1 = require("../models/Barber");
const Transaction_1 = require("../models/Transaction");
const Payment_1 = require("../models/Payment");
const Loan_1 = require("../models/Loan");
const LoanRepayment_1 = require("../models/LoanRepayment");
const AppError_1 = require("../utils/AppError");
const cacheService_1 = require("../cache/cacheService");
const money_1 = require("../utils/money");
const audit_service_1 = require("./audit.service");
const env_1 = require("../config/env");
async function listBarbers(salonId, opts = {}) {
    const query = { salon: salonId };
    if (opts.status)
        query.status = opts.status;
    if (opts.search)
        query.name = { $regex: opts.search, $options: 'i' };
    const barbers = await Barber_1.Barber.find(query).sort({ createdAt: 1 }).lean();
    if (!barbers.length)
        return [];
    const ids = barbers.map((b) => b._id);
    const [txnAgg, loanAgg, payoutAgg, fromEarningsAgg] = await Promise.all([
        Transaction_1.Transaction.aggregate([
            { $match: { barber: { $in: ids }, status: 'completed' } },
            {
                $group: {
                    _id: '$barber',
                    count: { $sum: 1 },
                    volume: { $sum: '$totalAmount' },
                    manager: { $sum: '$managerShare' },
                    barberShare: { $sum: '$barberShare' },
                },
            },
        ]),
        Loan_1.Loan.aggregate([
            { $match: { barber: { $in: ids }, status: 'active' } },
            { $group: { _id: '$barber', total: { $sum: '$outstandingAmount' }, count: { $sum: 1 } } },
        ]),
        Payment_1.Payment.aggregate([
            { $match: { barber: { $in: ids }, type: 'barber_payout', status: 'paid' } },
            { $group: { _id: '$barber', total: { $sum: '$amount' } } },
        ]),
        LoanRepayment_1.LoanRepayment.aggregate([
            { $match: { barber: { $in: ids }, method: 'from_earnings' } },
            { $group: { _id: '$barber', total: { $sum: '$amount' } } },
        ]),
    ]);
    const txnMap = new Map(txnAgg.map((t) => [String(t._id), t]));
    const loanMap = new Map(loanAgg.map((l) => [String(l._id), l]));
    const payoutMap = new Map(payoutAgg.map((p) => [String(p._id), p]));
    const fromEarningsMap = new Map(fromEarningsAgg.map((f) => [String(f._id), f]));
    const round2 = (n) => (0, money_1.fromCents)(Math.round(n * 100));
    return barbers.map((b) => {
        const t = txnMap.get(String(b._id));
        const l = loanMap.get(String(b._id));
        const p = payoutMap.get(String(b._id));
        const f = fromEarningsMap.get(String(b._id));
        const barberShare = round2(t?.barberShare ?? 0);
        const paidOut = round2(p?.total ?? 0);
        const fromEarnings = round2(f?.total ?? 0);
        const outstandingLoans = round2(l?.total ?? 0);
        // Available = 40% earned minus what was already paid out AND minus earnings
        // already consumed settling loans. An outstanding loan does NOT reduce the
        // shown amount until the manager marks the barber as paid.
        const availableEarnings = Math.max(0, round2(barberShare - paidOut - fromEarnings));
        return {
            ...b,
            stats: {
                transactionCount: t?.count ?? 0,
                transactionVolume: round2(t?.volume ?? 0),
                managerShare: round2(t?.manager ?? 0),
                barberShare,
                paidOut,
                availableEarnings,
                outstandingLoans,
                activeLoans: l?.count ?? 0,
            },
        };
    });
}
async function getBarber(salonId, barberId) {
    const roots = await listBarbers(salonId);
    const barber = roots.find((b) => String(b._id) === barberId);
    if (!barber)
        throw AppError_1.AppError.notFound('Barber not found in your salon.');
    const [recentTransactions, repayments, loans] = await Promise.all([
        Transaction_1.Transaction.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).limit(15).lean(),
        LoanRepayment_1.LoanRepayment.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).limit(25).populate('loan', 'amount reason').lean(),
        Loan_1.Loan.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).lean(),
    ]);
    return { barber, recentTransactions, repayments, loans };
}
async function createBarber(salonId, data) {
    const existing = await Barber_1.Barber.findOne({ salon: salonId, phone: data.phone }).lean();
    if (existing)
        throw AppError_1.AppError.conflict('A barber with this phone number already exists in your salon.');
    const barber = await Barber_1.Barber.create({
        salon: salonId,
        name: data.name.trim(),
        phone: data.phone.trim(),
        email: data.email?.trim() ?? '',
        gender: data.gender ?? '',
        role: data.role?.trim() || 'Barber',
        specializations: data.specializations ?? [],
    });
    (0, audit_service_1.auditTrail)(null, {
        action: 'barber.created',
        entity: 'Barber',
        entityId: barber._id,
        salon: salonId,
        after: { name: barber.name, phone: barber.phone },
    });
    await (0, cacheService_1.invalidateSalon)(salonId);
    return barber;
}
async function updateBarber(salonId, barberId, data) {
    const barber = await Barber_1.Barber.findOne({ _id: barberId, salon: salonId });
    if (!barber)
        throw AppError_1.AppError.notFound('Barber not found in your salon.');
    if (data.phone && data.phone !== barber.phone) {
        const clash = await Barber_1.Barber.findOne({ salon: salonId, phone: data.phone.trim(), _id: { $ne: barberId } }).lean();
        if (clash)
            throw AppError_1.AppError.conflict('Another barber in your salon already uses this phone number.');
    }
    const before = barber.toObject();
    barber.name = data.name?.trim() ?? barber.name;
    barber.phone = data.phone?.trim() ?? barber.phone;
    if (data.email !== undefined)
        barber.email = data.email?.trim() ?? '';
    if (data.gender !== undefined)
        barber.gender = (data.gender ?? '');
    if (data.role !== undefined)
        barber.role = data.role?.trim() || 'Barber';
    if (data.specializations !== undefined)
        barber.specializations = data.specializations;
    if (data.status !== undefined)
        barber.status = data.status;
    await barber.save();
    (0, audit_service_1.auditTrail)(null, {
        action: 'barber.updated',
        entity: 'Barber',
        entityId: barber._id,
        salon: salonId,
        before,
        after: barber.toObject(),
    });
    await (0, cacheService_1.invalidateSalon)(salonId);
    return barber;
}
async function setBarberPin(salonId, barberId, pin) {
    const barber = await Barber_1.Barber.findOne({ _id: barberId, salon: salonId });
    if (!barber)
        throw AppError_1.AppError.notFound('Barber not found in your salon.');
    const newPin = pin ?? String(Math.floor(100000 + Math.random() * 900000));
    barber.accessPinHash = await bcryptjs_1.default.hash(newPin, env_1.env.BCRYPT_ROUNDS);
    await barber.save();
    await (0, cacheService_1.invalidateSalon)(salonId);
    return newPin;
}
async function deleteBarber(salonId, barberId) {
    const barber = await Barber_1.Barber.findOne({ _id: barberId, salon: salonId });
    if (!barber)
        throw AppError_1.AppError.notFound('Barber not found in your salon.');
    const hasTransactions = await Transaction_1.Transaction.exists({ barber: barberId });
    const hasActiveLoans = await Loan_1.Loan.exists({ barber: barberId, status: 'active' });
    if (hasTransactions) {
        throw AppError_1.AppError.badRequest('This barber has recorded transactions and cannot be deleted. Set their status to inactive instead to preserve the financial audit history.');
    }
    if (hasActiveLoans) {
        throw AppError_1.AppError.badRequest('This barber has active loans. Settle them before removing the barber.');
    }
    await Barber_1.Barber.deleteOne({ _id: barberId });
    (0, audit_service_1.auditTrail)(null, {
        action: 'barber.deleted',
        entity: 'Barber',
        entityId: barberId,
        salon: salonId,
    });
    await (0, cacheService_1.invalidateSalon)(salonId);
}
//# sourceMappingURL=barber.service.js.map