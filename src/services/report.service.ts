import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { Transaction } from '../models/Transaction';
import { Loan } from '../models/Loan';
import { LoanRepayment } from '../models/LoanRepayment';
import { Report, type ReportDocument } from '../models/Report';
import { Barber } from '../models/Barber';
import { AppError } from '../utils/AppError';
import { fromCents } from '../utils/money';
import { invalidateSalon } from '../cache/cacheService';
import { auditTrail } from './audit.service';
import { oid } from '../utils/oid';
import { refreshWallet } from './wallet.service';

dayjs.extend(isoWeek);

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'six_month' | 'annual' | 'custom';

export interface ReportRange {
  start: Date;
  end: Date;
  label: string;
}

export function resolveRange(type: ReportType, dateStr?: string, startStr?: string, endStr?: string): ReportRange {
  const ref = dateStr ? dayjs(dateStr) : dayjs();

  switch (type) {
    case 'daily':
      return {
        start: ref.startOf('day').toDate(),
        end: ref.endOf('day').toDate(),
        label: ref.format('YYYY-MM-DD'),
      };
    case 'weekly':
      return {
        start: ref.startOf('isoWeek').toDate(),
        end: ref.endOf('isoWeek').toDate(),
        label: `${ref.startOf('isoWeek').format('DD MMM YYYY')} – ${ref.endOf('isoWeek').format('DD MMM YYYY')}`,
      };
    case 'monthly':
      return {
        start: ref.startOf('month').toDate(),
        end: ref.endOf('month').toDate(),
        label: ref.format('MMMM YYYY'),
      };
    case 'six_month': {
      const start = ref.subtract(6, 'month');
      return { start: start.toDate(), end: ref.endOf('day').toDate(), label: `${start.format('DD MMM YYYY')} – ${ref.format('DD MMM YYYY')}` };
    }
    case 'annual': {
      const start = ref.subtract(12, 'month');
      return { start: start.toDate(), end: ref.endOf('day').toDate(), label: `${start.format('DD MMM YYYY')} – ${ref.format('DD MMM YYYY')}` };
    }
    case 'custom': {
      if (!startStr || !endStr) throw AppError.badRequest('Custom reports require startDate and endDate.');
      const s = dayjs(startStr);
      const e = dayjs(endStr).endOf('day');
      if (e.isBefore(s)) throw AppError.badRequest('End date must be after start date.');
      return { start: s.toDate(), end: e.toDate(), label: `${s.format('DD MMM YYYY')} – ${e.format('DD MMM YYYY')}` };
    }
    default:
      throw AppError.badRequest('Unsupported report type.');
  }
}

const round2 = (n: number) => fromCents(Math.round(n * 100));

export interface GeneratedReport {
  report: unknown;
  csv: string;
}

export async function generateReport(
  salonId: string,
  type: ReportType,
  opts: { date?: string; startDate?: string; endDate?: string; generatedBy?: string },
): Promise<GeneratedReport> {
  const range = resolveRange(type, opts.date, opts.startDate, opts.endDate);
  const sid = oid(salonId);

  const [txnAgg, perBarberAgg, loansIssuedAgg, repayAgg, outstandingAgg] = await Promise.all([
    Transaction.aggregate<{ count: number; volume: number; manager: number; barberShare: number }>([
      { $match: { salon: sid, status: 'completed', createdAt: { $gte: range.start, $lte: range.end } } },
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
    Transaction.aggregate<{ _id: string; count: number; volume: number; manager: number; barberShare: number }>([
      { $match: { salon: sid, status: 'completed', createdAt: { $gte: range.start, $lte: range.end } } },
      {
        $group: {
          _id: '$barber',
          count: { $sum: 1 },
          volume: { $sum: '$totalAmount' },
          manager: { $sum: '$managerShare' },
          barberShare: { $sum: '$barberShare' },
        },
      },
      { $sort: { volume: -1 } },
    ]),
    Loan.aggregate<{ total: number; count: number }>([
      { $match: { salon: sid, createdAt: { $gte: range.start, $lte: range.end } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    LoanRepayment.aggregate<{ total: number; count: number }>([
      { $match: { salon: sid, createdAt: { $gte: range.start, $lte: range.end } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Loan.aggregate<{ total: number }>([
      { $match: { salon: sid, status: 'active', createdAt: { $lte: range.end } } },
      { $group: { _id: null, total: { $sum: '$outstandingAmount' } } },
    ]),
  ]);

  const nameMap = new Map<string, string>();
  const barberIds = perBarberAgg.map((b) => b._id);
  if (barberIds.length) {
    const barbers = await Barber.find({ _id: { $in: barberIds } }).select('name').lean();
    for (const b of barbers) nameMap.set(String(b._id), b.name);
  }

  const perBarber = perBarberAgg.map((b) => ({
    barber: b._id,
    name: nameMap.get(String(b._id)) ?? 'Unknown',
    transactionCount: b.count,
    transactionVolume: round2(b.volume),
    managerShare: round2(b.manager),
    barberShare: round2(b.barberShare),
  }));

  const totals = {
    transactionVolume: round2(txnAgg[0]?.volume ?? 0),
    managerEarnings: round2(txnAgg[0]?.manager ?? 0),
    barberEarnings: round2(txnAgg[0]?.barberShare ?? 0),
    transactionCount: txnAgg[0]?.count ?? 0,
    loanRepaymentsReceived: round2(repayAgg[0]?.total ?? 0),
    outstandingLoans: round2(outstandingAgg[0]?.total ?? 0),
  };

  const report = await Report.create({
    salon: salonId,
    reportType: type,
    title: `${type.replace('_', ' ').toUpperCase()} Report — ${range.label}`,
    periodStart: range.start,
    periodEnd: range.end,
    totals,
    perBarber,
    loansIssued: round2(loansIssuedAgg[0]?.total ?? 0),
    loansRepaid: round2(repayAgg[0]?.total ?? 0),
    generatedBy: opts.generatedBy,
  });

  auditTrail(null, {
    action: 'report.generated',
    entity: 'Report',
    entityId: report._id,
    salon: salonId,
    after: { type, range: range.label },
  });

  await invalidateSalon(salonId);

  const csv = buildCsv({ report, range, perBarber, loansIssuedAgg: loansIssuedAgg[0], repayAgg: repayAgg[0], outstanding: totalAgg(outstandingAgg) });

  return { report, csv };
}

function totalAgg(agg: { total: number }[]): number {
  return round2(agg[0]?.total ?? 0);
}

/**
 * Neutralizes spreadsheet formula injection: values beginning with = + - @ or a
 * tab would otherwise be executed as formulas when the CSV is opened in Excel
 * or Google Sheets. Prefixed with a single quote (the OWASP-recommended escape).
 */
function csvCell(value: unknown): string {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s.trimStart())) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(data: {
  report: ReportDocument;
  range: ReportRange;
  perBarber: { name: string; transactionCount: number; transactionVolume: number; managerShare: number; barberShare: number }[];
  loansIssuedAgg: { total: number; count: number } | undefined;
  repayAgg: { total: number; count: number } | undefined;
  outstanding: number;
}): string {
  const r = data.report;
  const totals = (r.totals ?? {}) as { transactionVolume: number; managerEarnings: number; barberEarnings: number; transactionCount: number };
  const rows: string[][] = [];
  const CURRENCY = 'RWF';
  rows.push([`${r.title}`]);
  rows.push(['Generated at', new Date().toISOString()]);
  rows.push(['Currency', CURRENCY]);
  rows.push(['']);
  rows.push(['TOTAL TRANSACTION VOLUME', totals.transactionVolume.toFixed(2)]);
  rows.push(['MANAGER 60% EARNINGS', totals.managerEarnings.toFixed(2)]);
  rows.push(['BARBER 40% EARNINGS', totals.barberEarnings.toFixed(2)]);
  rows.push(['TRANSACTION COUNT', String(totals.transactionCount)]);
  rows.push(['LOANS ISSUED IN PERIOD', (data.loansIssuedAgg?.total ?? 0).toFixed(2)]);
  rows.push(['LOANS REPAID IN PERIOD', (data.repayAgg?.total ?? 0).toFixed(2)]);
  rows.push(['OUTSTANDING LOANS', data.outstanding.toFixed(2)]);
  rows.push(['']);
  rows.push(['Barber', 'Transactions', 'Volume (RWF)', 'Manager Share (RWF)', 'Barber Share (RWF)']);
  for (const b of data.perBarber) {
    rows.push([b.name, b.transactionCount.toString(), b.transactionVolume.toFixed(2), b.managerShare.toFixed(2), b.barberShare.toFixed(2)]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export async function listReports(salonId: string, opts: { type?: string; page?: number; limit?: number } = {}): Promise<{
  items: ReportDocument[];
  total: number;
  page: number;
  pages: number;
}> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const query: Record<string, unknown> = { salon: salonId };
  if (opts.type) query.reportType = opts.type;
  const [items, total] = await Promise.all([
    Report.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Report.countDocuments(query),
  ]);
  return { items: items as ReportDocument[], total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}