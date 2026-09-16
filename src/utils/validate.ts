import { RequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from './AppError';

/**
 * Validates request params/query/body against zod schemas.
 * Fails fast with a 400 and clear details — financial endpoints rely on this
 * to reject negative, non-numeric or string-mangled amounts.
 */
export function validate(schemas: { params?: ZodSchema; query?: ZodSchema; body?: ZodSchema }): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      next(AppError.badRequest('Invalid request data', (err as { issues?: unknown }).issues));
    }
  };
}