import dayjs from 'dayjs';
import { Transaction } from '../models/Transaction';
import { Payment } from '../models/Payment';
import { Loan } from '../models/Loan';
import { LoanRepayment } from '../models/LoanRepayment';
import { Report } from '../models/Report';
import { Archive } from '../models/Archive';
import { env } from '../config/env';
import { invalidateSalon } from '../cache/cacheService';
import { auditTrail } from './audit.service';
import { logger } from '../utils/logger';

export interface RetentionResult {
  months: number;
  archived: {
    transactions: number;
    payments: number;
    loans: number;
    repayments: number;
    reports: number;
  };
  cleanedFrom: Date;
}

/**
 * Six-month data-retention/archiving. Never blindly deletes: old operational
 * records are first copied (full payload, including the original transaction
 * amount AND both shares) into the Archive collection, then removed from the
 * live collections. Active loans are never touched. Idempotent via a unique
 * (originalId, kind) index.
 */
export async function runRetention(options: { salonId?: string; months?: number; actor?: string } = {}): Promise<RetentionResult> {
  const months = options.months ?? env.RETENTION_MONTHS;
  const cut = dayjs().subtract(months, 'month').toDate();
  const salonFilter = options.salonId ? { salon: options.salonId } : {};
  const actor = options.actor;

  const result: RetentionResult = {
    months,
    archived: { transactions: 0, payments: 0, loans: 0, repayments: 0, reports: 0 },
    cleanedFrom: cut,
  };

  const counterKey: Record<'transaction' | 'payment' | 'loan' | 'repayment' | 'report', 'transactions' | 'payments' | 'loans' | 'repayments' | 'reports'> = {
    transaction: 'transactions',
    payment: 'payments',
    loan: 'loans',
    repayment: 'repayments',
    report: 'reports',
  };

  const archiveBatch = async (kind: 'transaction' | 'payment' | 'loan' | 'repayment' | 'report', docs: unknown[], del?: () => Promise<unknown>) => {
    if (!docs.length) return;
    let inserted = 0;
    for (const doc of docs as Array<{ _id: { toString(): string }; toObject?: () => unknown }>) {
      try {
        await Archive.create({
          kind,
          originalId: String(doc._id),
          salon: salonFilter.salon ?? (doc as { salon?: unknown }).salon ?? undefined,
          barber: (doc as { barber?: unknown }).barber ?? undefined,
          payload: typeof doc.toObject === 'function' ? doc.toObject() : doc,
          archivedAt: new Date(),
          archivedBy: actor ? (actor as unknown as string) : undefined,
        });
        inserted++;
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // skip duplicates
      }
    }
    await del?.();
    result.archived[counterKey[kind]] += inserted;
  };

  // 1. Transactions older than the retention window (with full split preserved)
  const salonsWithOldTxns = await Transaction.distinct('salon', {
    status: 'completed',
    createdAt: { $lt: cut },
    ...salonFilter,
  });

  for (const s of salonsWithOldTxns as unknown[]) {
    const docs = await Transaction.find({ salon: s, status: 'completed', createdAt: { $lt: cut } })
      .select('+clientRefId')
      .limit(500);
    if (docs.length) {
      await archiveBatch('transaction', docs, async () => {
        await Transaction.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
      });
      await invalidateSalon(String(s));
    }
  }

  // 2. Customer payments older than the window (associated with archived txns)
  const oldPayDocs = await Payment.find({ type: 'customer_payment', createdAt: { $lt: cut }, ...salonFilter }).limit(500);
  if (oldPayDocs.length) {
    await archiveBatch('payment', oldPayDocs, async () => {
      await Payment.deleteMany({ _id: { $in: oldPayDocs.map((d) => d._id) } });
    });
  }

  // 3. Settled loans older than the window + their repayments (active loans untouched)
  const oldLoans = await Loan.find({ status: 'settled', updatedAt: { $lt: cut }, ...salonFilter }).limit(500);
  if (oldLoans.length) {
    const loanIds = oldLoans.map((l) => l._id);
    const reps = await LoanRepayment.find({ loan: { $in: loanIds } });
    if (reps.length) {
      await archiveBatch('repayment', reps, async () => {
        await LoanRepayment.deleteMany({ _id: { $in: reps.map((d) => d._id) } });
      });
    }
    await archiveBatch('loan', oldLoans, async () => {
      await Loan.deleteMany({ _id: { $in: loanIds } });
    });
  }

  // 4. Stored reports older than the window
  const oldReports = await Report.find({ createdAt: { $lt: cut }, ...salonFilter }).limit(500);
  if (oldReports.length) {
    await archiveBatch('report', oldReports, async () => {
      await Report.deleteMany({ _id: { $in: oldReports.map((d) => d._id) } });
    });
  }

  auditTrail(null, {
    action: 'retention.run',
    entity: 'Archive',
    salon: salonFilter.salon ?? null,
    after: result,
    meta: { actorRole: 'system' },
  });

  logger.info(`[retention] archived ${JSON.stringify(result.archived)} records older than ${months} months`);
  return result;
}