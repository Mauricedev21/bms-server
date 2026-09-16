import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authLimiter } from '../middleware/rateLimiter';
import { protect } from '../middleware/auth';
import { validate } from '../utils/validate';
import { AppError } from '../utils/AppError';
import { registerSchema, loginSchema, changePasswordSchema } from '../utils/zodSchemas';
import { register, login, me, logout, changePassword } from '../controllers/auth.controller';
import { env } from '../config/env';

const router = Router();

/** Admissions gate — registration can be turned off in production. */
const registrationEnabled = (_req: Request, _res: Response, next: NextFunction) => {
  if (!env.ALLOW_REGISTRATION) {
    return next(AppError.forbidden('Registration is currently disabled.'));
  }
  next();
};

router.post('/register', authLimiter, registrationEnabled, validate({ body: registerSchema }), register);
router.post('/login', authLimiter, validate({ body: loginSchema }), login);
router.get('/me', protect, me);
router.post('/logout', protect, logout);
router.post('/change-password', protect, validate({ body: changePasswordSchema }), changePassword);

export default router;