import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { barberPortalService } from '../services/barberPortal.service';
import { checkLoginAttempts, recordLoginAttempt, clearLoginAttempts } from '../middleware/rateLimiter';

export const portalLogin = asyncHandler(async (req: Request, res: Response) => {
  const phone = String(req.body.phone ?? '').trim();
  checkLoginAttempts(phone);
  let token: string;
  let barber: { _id: unknown; name: string; phone: string; role: string };
  try {
    ({ token, barber } = await barberPortalService.login(phone, req.body.pin));
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 401) recordLoginAttempt(phone);
    throw err;
  }
  clearLoginAttempts(phone);
  res.json({
    success: true,
    data: {
      token,
      barber: { _id: barber._id, name: barber.name, phone: barber.phone, role: barber.role },
    },
  });
});

export const portalMe = asyncHandler(async (req: Request, res: Response) => {
  const barber = req.barber!;
  const summary = await barberPortalService.summary(String(barber.salon), String(barber._id));
  res.json({
    success: true,
    data: {
      barber: { _id: barber._id, name: barber.name, phone: barber.phone, role: barber.role, salon: barber.salon },
      summary,
    },
  });
});

export const portalTransactions = asyncHandler(async (req: Request, res: Response) => {
  const barber = req.barber!;
  const txns = await barberPortalService.myTransactions(String(barber.salon), String(barber._id));
  res.json({ success: true, data: { transactions: txns } });
});

export const portalLoans = asyncHandler(async (req: Request, res: Response) => {
  const barber = req.barber!;
  const { Loan } = await import('../models/Loan');
  const { LoanRepayment } = await import('../models/LoanRepayment');
  const loans = await Loan.find({ salon: barber.salon, barber: barber._id }).sort({ createdAt: -1 }).lean();
  const repayments = await LoanRepayment.find({ salon: barber.salon, barber: barber._id }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { loans, repayments } });
});