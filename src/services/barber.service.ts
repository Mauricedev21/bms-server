import bcrypt from 'bcryptjs';
import { Barber, type BarberDocument } from '../models/Barber';
import { Transaction } from '../models/Transaction';
import { Payment } from '../models/Payment';
import { Loan } from '../models/Loan';
import { LoanRepayment } from '../models/LoanRepayment';
import { AppError } from '../utils/AppError';
import { invalidateSalon } from '../cache/cacheService';
import { fromCents } from '../utils/money';
import { auditTrail } from './audit.service';
import { env } from '../config/env';

export interface BarberWithStats extends BarberDocument {
  stats: {
    transactionCount: number;
    transactionVolume: number;
    managerShare: number;
    barberShare: number;
    paidOut: number;
    availableEarnings: number;
    outstandingLoans: number;
    activeLoans: number;
  };
}

export async function listBarbers(salonId: string, opts: { search?: string; status?: string } = {}): Promise<BarberWithStats[]> {
  const query: Record<string, unknown> = { salon: salonId };
  if (opts.status) query.status = opts.status;
  if (opts.search) query.name = { $regex: opts.search, $options: 'i' };

  const barbers = await Barber.find(query).sort({ createdAt: 1 }).lean();
  if (!barbers.length) return [];

  const ids = barbers.map((b) => b._id);
  const [txnAgg, loanAgg, payoutAgg, fromEarningsAgg] = await Promise.all([
    Transaction.aggregate<{ _id: string; count: number; volume: number; manager: number; barberShare: number }>([
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
    Loan.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { barber: { $in: ids }, status: 'active' } },
      { $group: { _id: '$barber', total: { $sum: '$outstandingAmount' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate<{ _id: string; total: number }>([
      { $match: { barber: { $in: ids }, type: 'barber_payout', status: 'paid' } },
      { $group: { _id: '$barber', total: { $sum: '$amount' } } },
    ]),
    LoanRepayment.aggregate<{ _id: string; total: number }>([
      { $match: { barber: { $in: ids }, method: 'from_earnings' } },
      { $group: { _id: '$barber', total: { $sum: '$amount' } } },
    ]),
  ]);

  const txnMap = new Map(txnAgg.map((t) => [String(t._id), t]));
  const loanMap = new Map(loanAgg.map((l) => [String(l._id), l]));
  const payoutMap = new Map(payoutAgg.map((p) => [String(p._id), p]));
  const fromEarningsMap = new Map(fromEarningsAgg.map((f) => [String(f._id), f]));

  const round2 = (n: number) => fromCents(Math.round(n * 100));

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

export async function getBarber(salonId: string, barberId: string): Promise<{
  barber: BarberWithStats;
  recentTransactions: unknown[];
  repayments: unknown[];
  loans: unknown[];
}> {
  const roots = await listBarbers(salonId);
  const barber = roots.find((b) => String(b._id) === barberId);
  if (!barber) throw AppError.notFound('Barber not found in your salon.');

  const [recentTransactions, repayments, loans] = await Promise.all([
    Transaction.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).limit(15).lean(),
    LoanRepayment.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).limit(25).populate('loan', 'amount reason').lean(),
    Loan.find({ salon: salonId, barber: barberId }).sort({ createdAt: -1 }).lean(),
  ]);

  return { barber, recentTransactions, repayments, loans };
}

export async function createBarber(
  salonId: string,
  data: { name: string; phone: string; email?: string; gender?: string; role?: string; specializations?: string[] },
): Promise<BarberDocument> {
  const existing = await Barber.findOne({ salon: salonId, phone: data.phone }).lean();
  if (existing) throw AppError.conflict('A barber with this phone number already exists in your salon.');

  const barber = await Barber.create({
    salon: salonId,
    name: data.name.trim(),
    phone: data.phone.trim(),
    email: data.email?.trim() ?? '',
    gender: data.gender ?? '',
    role: data.role?.trim() || 'Barber',
    specializations: data.specializations ?? [],
  });

  auditTrail(null, {
    action: 'barber.created',
    entity: 'Barber',
    entityId: barber._id,
    salon: salonId,
    after: { name: barber.name, phone: barber.phone },
  });
  await invalidateSalon(salonId);
  return barber;
}

export async function updateBarber(
  salonId: string,
  barberId: string,
  data: {
    name?: string;
    phone?: string;
    email?: string;
    gender?: string;
    role?: string;
    specializations?: string[];
    status?: 'active' | 'inactive';
  },
): Promise<BarberDocument> {
  const barber = await Barber.findOne({ _id: barberId, salon: salonId });
  if (!barber) throw AppError.notFound('Barber not found in your salon.');

  if (data.phone && data.phone !== barber.phone) {
    const clash = await Barber.findOne({ salon: salonId, phone: data.phone.trim(), _id: { $ne: barberId } }).lean();
    if (clash) throw AppError.conflict('Another barber in your salon already uses this phone number.');
  }

  const before = barber.toObject();
  barber.name = data.name?.trim() ?? barber.name;
  barber.phone = data.phone?.trim() ?? barber.phone;
  if (data.email !== undefined) barber.email = data.email?.trim() ?? '';
  if (data.gender !== undefined) barber.gender = (data.gender ?? '') as BarberDocument['gender'];
  if (data.role !== undefined) barber.role = data.role?.trim() || 'Barber';
  if (data.specializations !== undefined) barber.specializations = data.specializations;
  if (data.status !== undefined) barber.status = data.status;
  await barber.save();

  auditTrail(null, {
    action: 'barber.updated',
    entity: 'Barber',
    entityId: barber._id,
    salon: salonId,
    before,
    after: barber.toObject(),
  });
  await invalidateSalon(salonId);
  return barber;
}

export async function setBarberPin(salonId: string, barberId: string, pin?: string): Promise<string> {
  const barber = await Barber.findOne({ _id: barberId, salon: salonId });
  if (!barber) throw AppError.notFound('Barber not found in your salon.');
  const newPin = pin ?? String(Math.floor(100000 + Math.random() * 900000));
  barber.accessPinHash = await bcrypt.hash(newPin, env.BCRYPT_ROUNDS);
  await barber.save();
  await invalidateSalon(salonId);
  return newPin;
}

export async function deleteBarber(salonId: string, barberId: string): Promise<void> {
  const barber = await Barber.findOne({ _id: barberId, salon: salonId });
  if (!barber) throw AppError.notFound('Barber not found in your salon.');
  const hasTransactions = await Transaction.exists({ barber: barberId });
  const hasActiveLoans = await Loan.exists({ barber: barberId, status: 'active' });
  if (hasTransactions) {
    throw AppError.badRequest(
      'This barber has recorded transactions and cannot be deleted. Set their status to inactive instead to preserve the financial audit history.',
    );
  }
  if (hasActiveLoans) {
    throw AppError.badRequest('This barber has active loans. Settle them before removing the barber.');
  }
  await Barber.deleteOne({ _id: barberId });
  auditTrail(null, {
    action: 'barber.deleted',
    entity: 'Barber',
    entityId: barberId,
    salon: salonId,
  });
  await invalidateSalon(salonId);
}