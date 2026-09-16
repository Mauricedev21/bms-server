import { Transaction } from '../models/Transaction';
import { Payment } from '../models/Payment';
import { Loan } from '../models/Loan';
import { LoanRepayment } from '../models/LoanRepayment';
import { Barber } from '../models/Barber';
import { Wallet } from '../models/Wallet';
import { cache, cacheKeys, invalidateSalon } from '../cache/cacheService';
import { env } from '../config/env';
import { fromCents } from '../utils/money';
import { oid } from '../utils/oid';

export interface WalletSnapshot {
  salon: string;
  currency: string;
  totalTransactionVolume: number;
  totalTransactions: number;
  totalManagerEarnings: number;
  totalBarberEarnings: number;
  activeBarbers: number;
  totalMoneyReceived: number;
  totalPaidToBarbers: number;
  totalOutstandingLoans: number;
  totalLoanRepayments: number;
  totalRepaidFromEarnings: number;
  loanCount: number;
  /** Cash currently on hand = gross income minus payouts to barbers. */
  currentBalance: number;
  /** Barber 40% earnings not yet paid out (net of loan deductions from earnings). */
  unpaidBarberEarnings: number;
  lastComputedFrom: Date;
}

/**
 * Recomputes ALL financial figures from the authoritative operations.
 * Runs after every financial write and is the single source the wallet card
 * and dashboard use. Never trusts cached numbers for truth.
 */
export async function recomputeWallet(salonId: string): Promise<WalletSnapshot> {
  const sid = oid(salonId);
  const [txnAgg, payoutsAgg, loansAgg, repayAgg, fromEarningsAgg, barberCount] = await Promise.all([
    Transaction.aggregate<{
      count: number;
      volume: number;
      manager: number;
      barberShare: number;
    }>([
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
    Payment.aggregate<{ total: number }>([
      { $match: { salon: sid, type: 'barber_payout', status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Loan.aggregate<{ total: number; count: number }>([
      { $match: { salon: sid, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$outstandingAmount' }, count: { $sum: 1 } } },
    ]),
    LoanRepayment.aggregate<{ total: number; count: number }>([
      { $match: { salon: sid } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    LoanRepayment.aggregate<{ total: number }>([
      { $match: { salon: sid, method: 'from_earnings' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Barber.countDocuments({ salon: salonId, status: 'active' }),
  ]);

  const round2 = (n: number) => fromCents(Math.round(n * 100));
  const row = (arr: unknown[], idx: number) =>
    (arr[idx] ?? null) as { count?: number; total?: number; volume?: number; manager?: number; barberShare?: number } | null;

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

  const snapshot: WalletSnapshot = {
    salon: salonId,
    currency: env.CURRENCY,
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

  await Wallet.updateOne(
    { salon: salonId },
    {
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
    },
    { upsert: true },
  );

  return snapshot;
}

export async function getWallet(salonId: string, force = false): Promise<WalletSnapshot> {
  const cachedKey = cacheKeys.wallet(salonId);
  if (!force) {
    const cached = await cache.get<WalletSnapshot>(cachedKey);
    if (cached) return cached;
  }
  const snapshot = await recomputeWallet(salonId);
  await cache.set(cachedKey, snapshot, env.CACHE_TTL_DASHBOARD);
  return snapshot;
}

export async function refreshWallet(salonId: string): Promise<WalletSnapshot> {
  await invalidateSalon(salonId);
  return recomputeWallet(salonId);
}