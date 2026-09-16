import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { listLoans, createLoan, getLoan, recordRepayment } from '../services/loan.service';
import { refreshWallet } from '../services/wallet.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await listLoans(String(req.salon!._id), {
    barber: req.query.barber as string | undefined,
    status: req.query.status as string | undefined,
    page: Number(req.query.page ?? 1),
    limit: Number(req.query.limit ?? 20),
  });
  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const loan = await createLoan(
    String(req.salon!._id),
    req.body.barber,
    req.body.amount,
    req.body.reason ?? '',
    String(req.reqUser!._id),
  );
  const walletSummary = await refreshWallet(String(req.salon!._id));
  res.status(201).json({ success: true, data: { loan, walletSummary } });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const result = await getLoan(String(req.salon!._id), req.params.id);
  res.json({ success: true, data: result });
});

export const repay = asyncHandler(async (req: Request, res: Response) => {
  const result = await recordRepayment(
    String(req.salon!._id),
    req.params.id,
    req.body.amount,
    req.body.method ?? 'cash',
    req.body.remark ?? '',
    String(req.reqUser!._id),
  );
  const walletSummary = await refreshWallet(String(req.salon!._id));
  res.json({ success: true, data: { ...result, walletSummary } });
});