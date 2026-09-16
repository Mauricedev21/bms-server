"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shares = shares;
exports.computeDashboardSummary = computeDashboardSummary;
const Transaction_1 = require("../models/Transaction");
const Barber_1 = require("../models/Barber");
const Loan_1 = require("../models/Loan");
const cacheService_1 = require("../cache/cacheService");
const env_1 = require("../config/env");
const wallet_service_1 = require("./wallet.service");
const money_1 = require("../utils/money");
const oid_1 = require("../utils/oid");
let cachedPercent = null;
function shares() {
    if (!cachedPercent)
        cachedPercent = { manager: env_1.env.MANAGER_SHARE_PERCENT, barber: env_1.env.BARBER_SHARE_PERCENT };
    return cachedPercent;
}
async function computeDashboardSummary(salonId, force = false) {
    const cachedKey = cacheService_1.cacheKeys.dashboard(salonId);
    if (!force) {
        const cached = await cacheService_1.cache.get(cachedKey);
        if (cached)
            return cached;
    }
    const wallet = await (0, wallet_service_1.getWallet)(salonId, force);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(dayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const sid = (0, oid_1.oid)(salonId);
    const [dayAgg, weekAgg, recent, topAgg, activeCount, loanCount] = await Promise.all([
        Transaction_1.Transaction.aggregate([
            { $match: { salon: sid, status: 'completed', createdAt: { $gte: dayStart } } },
            { $group: { _id: null, volume: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
        ]),
        Transaction_1.Transaction.aggregate([
            { $match: { salon: sid, status: 'completed', createdAt: { $gte: weekStart } } },
            { $group: { _id: null, volume: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
        ]),
        Transaction_1.Transaction.find({ salon: salonId, status: 'completed' })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('barber', 'name')
            .lean(),
        Transaction_1.Transaction.aggregate([
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
        Barber_1.Barber.countDocuments({ salon: salonId, status: 'active' }),
        Loan_1.Loan.countDocuments({ salon: salonId, status: 'active' }),
    ]);
    const barberNames = new Map();
    const barbers = await Barber_1.Barber.find({ _id: { $in: topAgg.map((t) => t._id) } }).select('name').lean();
    for (const b of barbers)
        barberNames.set(String(b._id), b.name);
    const round2 = (n) => (0, money_1.fromCents)(Math.round(n * 100));
    const topBarbers = topAgg.map((t) => ({
        _id: String(t._id),
        name: barberNames.get(String(t._id)) ?? 'Unknown barber',
        transactionCount: t.count,
        volume: round2(t.volume),
        managerShare: round2(t.manager),
        barberShare: round2(t.barberShare),
    }));
    const summary = {
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
    await cacheService_1.cache.set(cachedKey, summary, env_1.env.CACHE_TTL_DASHBOARD);
    return summary;
}
//# sourceMappingURL=dashboard.service.js.map