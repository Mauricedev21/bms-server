import { Transaction } from '../models/Transaction';
import { Barber } from '../models/Barber';
import { Loan } from '../models/Loan';
import { cache, cacheKeys } from '../cache/cacheService';
import { env } from '../config/env';
import { getWallet, type WalletSnapshot } from './wallet.service';
import { fromCents } from '../utils/money';
import { oid } from '../utils/oid';

export interface TopBarber {
  _id: string;
  name: string;
  transactionCount: number;
  volume: number;
  managerShare: number;
  barberShare: number;
}

export interface DashboardSummary {
  salonId: string;
  wallet: WalletSnapshot;
  recentTransactions: unknown[];
  today: { volume: number; count: number };
  week: { volume: number; count: number };
  topBarbers: TopBarber[];
  activeBarberCount: number;
  outstandingLoanCount: number;
  managerPercent: number;
  barberPercent: number;
  computedAt: Date;
}

let cachedPercent: { manager: number; barber: number } | null = null;
export function shares(): { manager: number; barber: number } {
  if (!cachedPercent) cachedPercent = { manager: env.MANAGER_SHARE_PERCENT, barber: env.BARBER_SHARE_PERCENT };
  return cachedPercent;
}

export async function computeDashboardSummary(salonId: string, force = false): Promise<DashboardSummary> {
  const cachedKey = cacheKeys.dashboard(salonId);
  if (!force) {
    const cached = await cache.get<DashboardSummary>(cachedKey);
    if (cached) return cached;
  }

  const wallet = await getWallet(salonId, force);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const sid = oid(salonId);
  const [dayAgg, weekAgg, recent, topAgg, activeCount, loanCount] = await Promise.all([
    Transaction.aggregate<{ volume: number; count: number }>([
      { $match: { salon: sid, status: 'completed', createdAt: { $gte: dayStart } } },
      { $group: { _id: null, volume: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate<{ volume: number; count: number }>([
      { $match: { salon: sid, status: 'completed', createdAt: { $gte: weekStart } } },
      { $group: { _id: null, volume: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
    ]),
    Transaction.find({ salon: salonId, status: 'completed' })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('barber', 'name')
      .lean(),
    Transaction.aggregate<{ _id: string; count: number; volume: number; manager: number; barberShare: number }>([
      { $match: { salon: sid, status: 'completed' } },
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
      { $limit: 5 },
    ]),
    Barber.countDocuments({ salon: salonId, status: 'active' }),
    Loan.countDocuments({ salon: salonId, status: 'active' }),
  ]);

  const barberNames = new Map<string, string>();
  const barbers = await Barber.find({ _id: { $in: topAgg.map((t) => t._id) } }).select('name').lean();
  for (const b of barbers) barberNames.set(String(b._id), b.name);

  const round2 = (n: number) => fromCents(Math.round(n * 100));
  const topBarbers: TopBarber[] = topAgg.map((t) => ({
    _id: String(t._id),
    name: barberNames.get(String(t._id)) ?? 'Unknown barber',
    transactionCount: t.count,
    volume: round2(t.volume),
    managerShare: round2(t.manager),
    barberShare: round2(t.barberShare),
  }));

  const summary: DashboardSummary = {
    salonId,
    wallet,
    recentTransactions: recent,
    today: { volume: round2(dayAgg[0]?.volume ?? 0), count: dayAgg[0]?.count ?? 0 },
    week: { volume: round2(weekAgg[0]?.volume ?? 0), count: weekAgg[0]?.count ?? 0 },
    topBarbers,
    activeBarberCount: activeCount,
    outstandingLoanCount: loanCount,
    managerPercent: shares().manager,
    barberPercent: shares().barber,
    computedAt: new Date(),
  };

  await cache.set(cachedKey, summary, env.CACHE_TTL_DASHBOARD);
  return summary;
}