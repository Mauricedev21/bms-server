import type { ErrorRequestHandler, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { isProd } from '../config/env';

export const errorHandler: ErrorRequestHandler = (err: unknown, req: Request, res: Response, _next) => {
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, e]) => [k, e.message]));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = 'Invalid id format';
    code = 'INVALID_ID';
  } else if ((err as { code?: number }).code === 11000) {
    statusCode = 409;
    message = 'Duplicate value — a record with this value already exists';
    code = 'DUPLICATE_KEY';
    const keyValue = (err as { keyValue?: unknown }).keyValue;
    if (keyValue) details = keyValue;
  } else if (err instanceof Error && err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  } else if (err instanceof Error && err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Session expired, please log in again';
    code = 'TOKEN_EXPIRED';
  }

  if (statusCode >= 500) {
    logger.error('[error] ' + (err instanceof Error ? err.stack || err.message : String(err)));
  } else {
    logger.warn(`[${code}] ${req.method} ${req.originalUrl} — ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details: isProd && statusCode >= 500 ? undefined : details,
    },
  });
};