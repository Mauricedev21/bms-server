import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  listBarbers,
  getBarber,
  createBarber,
  updateBarber,
  setBarberPin,
  deleteBarber,
} from '../services/barber.service';
import { recordBarberPayout } from '../services/transaction.service';
import { refreshWallet } from '../services/wallet.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const barbers = await listBarbers(String(req.salon!._id), {
    search: req.query.search as string | undefined,
    status: req.query.status as string | undefined,
  });
  const wallet = await refreshWallet(String(req.salon!._id));
  res.json({ success: true, data: { barbers, walletSummary: wallet } });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const result = await getBarber(String(req.salon!._id), req.params.id);
  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const barber = await createBarber(String(req.salon!._id), req.body);
  res.status(201).json({ success: true, data: { barber } });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const barber = await updateBarber(String(req.salon!._id), req.params.id, req.body);
  res.json({ success: true, data: { barber } });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await deleteBarber(String(req.salon!._id), req.params.id);
  res.json({ success: true, data: { message: 'Barber removed.' } });
});

export const generatePin = asyncHandler(async (req: Request, res: Response) => {
  const pin = await setBarberPin(String(req.salon!._id), req.params.id, req.body.pin as string | undefined);
  res.json({ success: true, data: { pin } });
});

export const payout = asyncHandler(async (req: Request, res: Response) => {
  const amount = typeof req.body.amount === 'number' && Number.isFinite(req.body.amount) ? req.body.amount : undefined;
  if (amount !== undefined && amount <= 0) {
    throw AppError.badRequest('Invalid payout amount.');
  }
  const result = await recordBarberPayout(
    String(req.salon!._id),
    req.params.id,
    amount,
    req.body.method ?? 'cash',
    String(req.reqUser!._id),
  );
  const wallet = await refreshWallet(String(req.salon!._id));
  res.status(201).json({ success: true, data: { ...result, walletSummary: wallet } });
});