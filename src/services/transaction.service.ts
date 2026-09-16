import { Transaction, type TransactionDocument } from '../models/Transaction';
import { Types } from 'mongoose';
import { Payment, type PaymentDocument } from '../models/Payment';
import { Barber } from '../models/Barber';
import { Loan } from '../models/Loan';
import { AppError } from '../utils/AppError';
import { calculateShare, isValidAmount, normalizeAmount, fromCents } from '../utils/money';
import { auditTrail } from './audit.service';
import { refreshWallet } from './wallet.service';
import { deductLoanFromEarnings, loanRepaidFromEarnings } from './loan.service';
import { invalidateSalon, cache, cacheKeys } from '../cache/cacheService';
import type { Request } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { oid } from '../utils/oid';

export interface CreateTransactionInput {
  salonId: string;
  barberId: string;
  totalAmount: number;
  paymentMethod: string;
  customerName?: string;
  service?: string;
  description?: string;
  clientRefId: string;
  recordedBy: string;
}

export interface TransactionFilters {
  salonId: string;
  barber?: string;
  paymentMethod?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * The ONLY place a customer transaction is created. The 60/40 split is computed
 * here on the backend — the frontend only supplies the total; it can never
 * dictate manager/barber shares.
 */
export async function createTransaction(input: CreateTransactionInput): Promise<TransactionDocument> {
  if (!isValidAmount(input.totalAmount)) {
    throw AppError.badRequest('Invalid total amount provided.');
  }

  const barber = await Barber.findOne({ _id: input.barberId, salon: input.salonId }).lean();
  if (!barber) throw AppError.badRequest('You can only record transactions for barbers in your own salon.');
  if (barber.status !== 'active') throw AppError.badRequest('This barber is not active.');

  const total = normalizeAmount(input.totalAmount);

  // Service auto-fills from the barber's specialization when not supplied. The
  // manager only records the total; the system classifies the service.
  const service = input.service?.trim() || (barber.specializations?.[0] ?? '');

  // ── Duplicate-submission protection ─────────────────────────────────────
  // 1) Strong: clientRefId is globally unique.
  const existingByRef = await Transaction.findOne({ clientRefId: input.clientRefId }).lean();
  if (existingByRef) {
    throw AppError.conflict('This transaction was already recorded (duplicate submission).', {
      code: 'DUPLICATE_REF',
    });
  }
  // 2) Defensive: identical amount to the same barber within 2 minutes.
  const recent = await Transaction.findOne({
    salon: input.salonId,
    barber: input.barberId,
    totalAmount: total,
    createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) },
  }).lean();
  if (recent) {
    throw AppError.conflict('An identical transaction for this barber was recorded moments ago. Review before submitting.', {
      code: 'DUPLICATE_RECENT',
      recentId: recent._id,
    });
  }

  const split = calculateShare(total);

  const txn = await Transaction.create({
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

  await Payment.create({
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

  auditTrail(null, {
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

  await refreshWallet(input.salonId);

  const populated = await Transaction.findById(txn._id).populate('barber', 'name phone').lean();
  return populated as TransactionDocument;
}

export async function listTransactions(filters: TransactionFilters): Promise<{
  items: TransactionDocument[];
  total: number;
  page: number;
  pages: number;
  summary: { volume: number; managerShare: number; barberShare: number; count: number };
}> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const query: Record<string, unknown> = { salon: filters.salonId };

  if (filters.barber) {
    const barber = await Barber.findOne({ _id: filters.barber, salon: filters.salonId }).lean();
    if (!barber) throw AppError.badRequest('Barber not found in your salon.');
    query.barber = filters.barber;
  }
  if (filters.paymentMethod) query.paymentMethod = filters.paymentMethod;
  if (filters.status) query.status = filters.status;

  if (filters.startDate || filters.endDate) {
    const range: Record<string, Date> = {};
    if (filters.startDate) range.$gte = new Date(filters.startDate);
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

  const cacheKey = cacheKeys.transactions(filters.salonId, JSON.stringify(query) + `:p${page}:l${limit}`);
  const cached = await cache.get<{ items: TransactionDocument[]; total: number; page: number; pages: number }>(cacheKey);
  if (cached) {
    const summary = await computeSummary(query);
    return { ...cached, summary };
  }

  const [items, total] = await Promise.all([
    Transaction.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('barber', 'name phone').lean(),
    Transaction.countDocuments(query),
  ]);

  const result = {
    items: items as TransactionDocument[],
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    summary: await computeSummary(query),
  };

  await cache.set(cacheKey, { items: result.items, total, page, pages: result.pages }, env.CACHE_TTL_LIST);
  return result;
}

async function computeSummary(query: Record<string, unknown>): Promise<{ volume: number; managerShare: number; barberShare: number; count: number }> {
  const aggQuery: Record<string, unknown> = { ...(query as object) };
  if (aggQuery.salon) aggQuery.salon = new Types.ObjectId(String(aggQuery.salon));
  if (aggQuery.barber) aggQuery.barber = new Types.ObjectId(String(aggQuery.barber));
  const agg = await Transaction.aggregate<{ volume: number; manager: number; barberShare: number; count: number }>([
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
    volume: r ? fromCents(Math.round(r.volume * 100)) : 0,
    managerShare: r ? fromCents(Math.round(r.manager * 100)) : 0,
    barberShare: r ? fromCents(Math.round(r.barberShare * 100)) : 0,
    count: r?.count ?? 0,
  };
}

export async function getTransaction(salonId: string, txnId: string): Promise<TransactionDocument> {
  const txn = await Transaction.findOne({ _id: txnId, salon: salonId }).populate('barber', 'name phone').lean();
  if (!txn) throw AppError.notFound('Transaction not found in your salon.');
  return txn as TransactionDocument;
}

/** Void a transaction (soft). Counts of the original amount remain in AuditLog */
export async function voidTransaction(salonId: string, txnId: string, reason: string): Promise<TransactionDocument> {
  const txn = await Transaction.findOne({ _id: txnId, salon: salonId });
  if (!txn) throw AppError.notFound('Transaction not found in your salon.');
  if (txn.status === 'voided') throw AppError.badRequest('Transaction already voided.');
  if (!reason.trim()) throw AppError.badRequest('A reason is required to void a transaction.');

  txn.status = 'voided';
  await txn.save();

  await Payment.updateOne({ transaction: txn._id }, { $set: { status: 'refunded' } });

  auditTrail(null, {
    action: 'transaction.voided',
    entity: 'Transaction',
    entityId: txn._id,
    salon: salonId,
    before: { status: 'completed' },
    after: { status: 'voided', reason },
  });

  await invalidateSalon(salonId);
  await refreshWallet(salonId);
  return txn.toObject() as TransactionDocument;
}

export interface BarberPayoutBreakdown {
  earned: number;
  alreadyPaid: number;
  repaidFromEarnings: number;
  availableEarnings: number;
  outstandingLoans: number;
  loanDeduction: number;
  netPayout: number;
}

export interface BarberPayoutResult {
  payment: PaymentDocument | null;
  breakdown: BarberPayoutBreakdown;
}

/**
 * Record a manager → barber payout from the barber's accumulated 40% share.
 * Outstanding loans are deducted automatically BEFORE the cash is handed over:
 * the deduction is recorded as `from_earnings` loan repayments (oldest loans
 * first) and the difference is paid out. Amount is optional — when omitted the
 * FULL available earnings are settled so the barber restarts at zero.
 */
export async function recordBarberPayout(
  salonId: string,
  barberId: string,
  amount: number | undefined,
  method: string,
  recordedBy: string,
): Promise<BarberPayoutResult> {
  const barber = await Barber.findOne({ _id: barberId, salon: salonId }).lean();
  if (!barber) throw AppError.badRequest('Barber not found in your salon.');
  if (barber.status !== 'active') throw AppError.badRequest('This barber is not active.');

  const [barberShareAgg, payoutAgg, outstandingAgg] = await Promise.all([
    Transaction.aggregate<{ total: number }>([
      { $match: { salon: oid(salonId), barber: oid(barberId), status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$barberShare' } } },
    ]),
    Payment.aggregate<{ total: number }>([
      { $match: { salon: oid(salonId), barber: oid(barberId), type: 'barber_payout', status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Loan.aggregate<{ total: number }>([
      { $match: { salon: oid(salonId), barber: oid(barberId), status: 'active' } },
      { $group: { _id: null, total: { $sum: '$outstandingAmount' } } },
    ]),
  ]);
  const earned = barberShareAgg[0]?.total ?? 0;
  const alreadyPaid = payoutAgg[0]?.total ?? 0;
  const repaidFromEarnings = await loanRepaidFromEarnings(salonId, barberId);
  const available = Math.max(0, fromCents(Math.round((earned - alreadyPaid - repaidFromEarnings) * 100)));
  const outstandingLoans = fromCents(Math.round((outstandingAgg[0]?.total ?? 0) * 100));

  const fullSettlement = amount === undefined || amount === null || !Number.isFinite(amount);
  const normalized = fullSettlement ? available : normalizeAmount(amount as number);
  if (normalized <= 0) throw AppError.badRequest('This barber has no available earnings to pay out.');
  if (normalized > available + 1e-6) {
    throw AppError.badRequest(
      `Payout exceeds this barber's available earnings (available: ${env.CURRENCY} ${available.toLocaleString()}).`,
    );
  }

  const loanDeduction = Math.min(outstandingLoans, normalized);
  const netPayout = fromCents(Math.round((normalized - loanDeduction) * 100));

  let deducted = 0;
  if (loanDeduction > 0) {
    deducted = await deductLoanFromEarnings(salonId, barberId, loanDeduction, recordedBy);
  }

  let payment: PaymentDocument | null = null;
  if (netPayout > 0) {
    payment = await Payment.create({
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

  auditTrail(null, {
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

  await refreshWallet(salonId);
  return {
    payment,
    breakdown: {
      earned: fromCents(Math.round(earned * 100)),
      alreadyPaid: fromCents(Math.round(alreadyPaid * 100)),
      repaidFromEarnings,
      availableEarnings: available,
      outstandingLoans,
      loanDeduction: deducted,
      netPayout,
    },
  };
}

export function recentTransactionsForCache(salonId: string, limit: number): string {
  return cacheKeys.transactions(salonId, `recent:${limit}`);
}

export { logger };