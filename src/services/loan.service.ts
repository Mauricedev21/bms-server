import { Loan, type LoanDocument } from '../models/Loan';
import { LoanRepayment, type LoanRepaymentDocument } from '../models/LoanRepayment';
import { Barber } from '../models/Barber';
import { AppError } from '../utils/AppError';
import { isValidAmount, normalizeAmount, fromCents } from '../utils/money';
import { invalidateSalon } from '../cache/cacheService';
import { auditTrail } from './audit.service';
import { refreshWallet } from './wallet.service';
import { oid } from '../utils/oid';

interface LoanWithRepaid extends LoanDocument {
  totalRepaid: number;
}

export function loanPopulateQuery() {
  return Loan.find();
}

export async function listLoans(
  salonId: string,
  filters: { barber?: string; status?: string; page?: number; limit?: number },
): Promise<{ items: LoanWithRepaid[]; total: number; page: number; pages: number }> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const query: Record<string, unknown> = { salon: salonId };
  if (filters.barber) {
    const barber = await Barber.findOne({ _id: filters.barber, salon: salonId }).lean();
    if (!barber) throw AppError.badRequest('Barber not found in your salon.');
    query.barber = filters.barber;
  }
  if (filters.status) query.status = filters.status;

  const [items, total, repaidAgg] = await Promise.all([
    Loan.find(query).sort({ createdAt: -1 }).populate('barber', 'name phone').lean(),
    Loan.countDocuments(query),
    LoanRepayment.aggregate<{ _id: string; total: number }>([
      { $match: { salon: oid(salonId) } },
      { $group: { _id: '$loan', total: { $sum: '$amount' } } },
    ]),
  ]);

  const repaidMap = new Map(repaidAgg.map((r) => [String(r._id), fromCents(Math.round(r.total * 100))]));
  const withRepaid = items.map((l) => ({ ...l, totalRepaid: repaidMap.get(String(l._id)) ?? 0 }));

  return { items: withRepaid, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function createLoan(
  salonId: string,
  barberId: string,
  amount: number,
  reason: string,
  createdBy: string,
): Promise<LoanDocument> {
  if (!isValidAmount(amount)) throw AppError.badRequest('Invalid loan amount.');
  const barber = await Barber.findOne({ _id: barberId, salon: salonId }).lean();
  if (!barber) throw AppError.badRequest('You can only give loans to barbers in your own salon.');
  if (barber.status !== 'active') throw AppError.badRequest('This barber is not active.');

  const normalized = normalizeAmount(amount);
  const loan = await Loan.create({
    salon: salonId,
    barber: barberId,
    amount: normalized,
    outstandingAmount: normalized,
    reason: reason?.trim() ?? '',
    status: 'active',
    createdBy,
  });

  auditTrail(null, {
    action: 'loan.created',
    entity: 'Loan',
    entityId: loan._id,
    salon: salonId,
    after: { amount: normalized, barber: barberId },
  });
  await invalidateSalon(salonId);
  await refreshWallet(salonId);
  return loan;
}

export async function getLoan(salonId: string, loanId: string): Promise<{ loan: LoanDocument; repayments: unknown[] }> {
  const loan = await Loan.findOne({ _id: loanId, salon: salonId }).populate('barber', 'name phone').lean();
  if (!loan) throw AppError.notFound('Loan not found in your salon.');
  const repayments = await LoanRepayment.find({ loan: loanId }).sort({ createdAt: -1 }).lean();
  return { loan, repayments };
}

export async function recordRepayment(
  salonId: string,
  loanId: string,
  amount: number,
  method: string,
  remark: string,
  recordedBy: string,
): Promise<{ loan: LoanDocument; repayment: LoanRepaymentDocument }> {
  if (!isValidAmount(amount)) throw AppError.badRequest('Invalid repayment amount.');

  const loan = await Loan.findOne({ _id: loanId, salon: salonId });
  if (!loan) throw AppError.notFound('Loan not found in your salon.');
  if (loan.outstandingAmount <= 0) throw AppError.badRequest('This loan is already fully settled.');

  const normalized = normalizeAmount(amount);
  if (normalized > loan.outstandingAmount + 1e-6) {
    throw AppError.badRequest(
      `Repayment exceeds the outstanding balance (remaining: ${loan.outstandingAmount.toLocaleString()}).`,
    );
  }

  const repayment = await LoanRepayment.create({
    salon: salonId,
    loan: loanId,
    barber: loan.barber,
    amount: normalized,
    method,
    remark: remark?.trim() ?? '',
    recordedBy,
  });

  loan.outstandingAmount = fromCents(Math.round((loan.outstandingAmount - normalized) * 100));
  if (loan.outstandingAmount <= 0) {
    loan.outstandingAmount = 0;
    loan.status = 'settled';
  }
  await loan.save();

  auditTrail(null, {
    action: 'loan.repayment',
    entity: 'Loan',
    entityId: loanId,
    salon: salonId,
    before: { outstandingAmount: loan.outstandingAmount + normalized },
    after: { outstandingAmount: loan.outstandingAmount, repayment: normalized },
  });

  await invalidateSalon(salonId);
  await refreshWallet(salonId);
  return { loan, repayment };
}

/**
 * Automatically settle outstanding loans from a barber's earnings, oldest loans
 * first, until `amount` is fully consumed. Creates `from_earnings` LoanRepayment
 * records and returns the total actually deducted. Used by the payout flow so a
 * barber's loans are always cleared before any cash is handed over.
 */
export async function deductLoanFromEarnings(
  salonId: string,
  barberId: string,
  amount: number,
  recordedBy: string,
): Promise<number> {
  let remaining = normalizeAmount(amount);
  let deducted = 0;
  if (remaining <= 0) return 0;

  const activeLoans = await Loan.find({ salon: salonId, barber: barberId, status: 'active' }).sort({ createdAt: 1 }).exec();
  for (const loan of activeLoans) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, loan.outstandingAmount);
    if (take <= 0) continue;

    await LoanRepayment.create({
      salon: salonId,
      loan: loan._id,
      barber: barberId,
      amount: take,
      method: 'from_earnings',
      remark: 'Automatic loan deduction from barber payment',
      recordedBy,
    });

    loan.outstandingAmount = fromCents(Math.round((loan.outstandingAmount - take) * 100));
    if (loan.outstandingAmount <= 0) {
      loan.outstandingAmount = 0;
      loan.status = 'settled';
    }
    await loan.save();

    remaining = fromCents(Math.round((remaining - take) * 100));
    deducted = fromCents(Math.round((deducted + take) * 100));
  }
  return deducted;
}

/** Total amount of loan repayments already taken out of a barber's earnings. */
export async function loanRepaidFromEarnings(salonId: string, barberId: string): Promise<number> {
  const agg = await LoanRepayment.aggregate<{ total: number }>([
    { $match: { salon: oid(salonId), barber: oid(barberId), method: 'from_earnings' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return agg[0]?.total ?? 0;
}