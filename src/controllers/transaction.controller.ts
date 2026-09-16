import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { createTransaction, listTransactions, getTransaction, voidTransaction } from '../services/transaction.service';
import { computeDashboardSummary } from '../services/dashboard.service';
import { refreshWallet } from '../services/wallet.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const salonId = String(req.salon!._id);
  const txn = await createTransaction({
    salonId,
    barberId: req.body.barber,
    totalAmount: req.body.totalAmount,
    paymentMethod: req.body.paymentMethod,
    customerName: req.body.customerName,
    service: req.body.service,
    description: req.body.description,
    clientRefId: req.body.clientRefId,
    recordedBy: String(req.reqUser!._id),
  });

  // Updated dashboard totals returned atomically with the new transaction.
  const [walletSummary, dashboard] = await Promise.all([
    refreshWallet(salonId),
    computeDashboardSummary(salonId, true),
  ]);

  res.status(201).json({ success: true, data: { transaction: txn, walletSummary, dashboard } });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await listTransactions({
    salonId: String(req.salon!._id),
    barber: req.query.barber as string | undefined,
    paymentMethod: req.query.paymentMethod as string | undefined,
    status: req.query.status as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    search: req.query.search as string | undefined,
    page: Number(req.query.page ?? 1),
    limit: Number(req.query.limit ?? 20),
  });
  res.json({ success: true, data: result });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const txn = await getTransaction(String(req.salon!._id), req.params.id);
  res.json({ success: true, data: { transaction: txn } });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const reason = String(req.body.reason ?? '');
  const txn = await voidTransaction(String(req.salon!._id), req.params.id, reason);
  const walletSummary = await refreshWallet(String(req.salon!._id));
  res.json({ success: true, data: { transaction: txn, message: 'Transaction voided.', walletSummary } });
});

export const createInputGuard = asyncHandler(async (_req: Request, _res: Response) => {
  throw AppError.badRequest('Use POST /transactions to record a transaction.');
});