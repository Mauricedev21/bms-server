import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { getWallet, recomputeWallet, type WalletSnapshot } from '../services/wallet.service';

export const financialStatus = asyncHandler(async (req: Request, res: Response) => {
  const salonId = String(req.salon!._id);
  const force = req.query.force === 'true';
  const wallet: WalletSnapshot = force ? await recomputeWallet(salonId) : await getWallet(salonId);

  const recentPayouts = await import('../models/Payment').then((m) =>
    m.Payment.find({ salon: salonId, type: 'barber_payout' }).sort({ createdAt: -1 }).limit(10).populate('barber', 'name').lean(),
  );

  res.json({ success: true, data: { wallet, recentPayouts } });
});