import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound('API endpoint not found'));
}