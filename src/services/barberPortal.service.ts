import bcrypt from 'bcryptjs';
import { Barber } from '../models/Barber';
import { Transaction } from '../models/Transaction';
import { Payment } from '../models/Payment';
import { Loan } from '../models/Loan';
import { LoanRepayment } from '../models/LoanRepayment';
import { AppError } from '../utils/AppError';
import { signToken } from '../utils/tokens';
import { fromCents } from '../utils/money';
import { oid } from '../utils/oid';

const DUMMY_PIN_HASH = '$2a$10$WOSwsmK56kGEZn1SKF4kJuI2cC/8.WVyrh.acf8QhIWyNINHL2hx.';

export const barberPortalService = {
  async login(phone: string, pin: string) {
    const barber = await Barber.findOne({ phone: phone.trim() }).select('+accessPinHash').lean();
    // Compare against a fixed dummy hash so unknown phones take the same time as known ones.
    const ok = await bcrypt.compare(pin, barber?.accessPinHash ?? DUMMY_PIN_HASH);
    if (!barber || !ok) throw AppError.unauthorized('Invalid phone or PIN.');
    if (barber.status !== 'active') throw AppError.forbidden('This barber account is not active.');
    const token = signToken({ uid: '', role: 'barber', salon: String(barber.salon), barber: String(barber._id) });
    return { token, barber };
  },

  async summary(salonId: string, barberId: string) {
    const [txnAgg, paidAgg, loanAgg, fromEarningsAgg] = await Promise.all([
      Transaction.aggregate<{ count: number; volume: number; barberShare: number }>([
        { $match: { salon: oid(salonId), barber: oid(barberId), status: 'completed' } },
        { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$totalAmount' }, barberShare: { $sum: '$barberShare' } } },
      ]),
      Payment.aggregate<{ total: number }>([
        { $match: { salon: oid(salonId), barber: oid(barberId), type: 'barber_payout', status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Loan.aggregate<{ total: number }>([
        { $match: { salon: oid(salonId), barber: oid(barberId), status: 'active' } },
        { $group: { _id: null, total: { $sum: '$outstandingAmount' } } },
      ]),
      LoanRepayment.aggregate<{ total: number }>([
        { $match: { salon: oid(salonId), barber: oid(barberId), method: 'from_earnings' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    const round2 = (n: number) => fromCents(Math.round(n * 100));
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

  async myTransactions(salonId: string, barberId: string) {
    return Transaction.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).limit(100).lean();
  },
};