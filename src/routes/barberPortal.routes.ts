import { Router } from 'express';
import { authLimiter } from '../middleware/rateLimiter';
import { protect } from '../middleware/auth';
import { validate } from '../utils/validate';
import { barberLoginSchema } from '../utils/zodSchemas';
import { portalLogin, portalMe, portalTransactions, portalLoans } from '../controllers/barberPortal.controller';

const router = Router();

router.post('/login', authLimiter, validate({ body: barberLoginSchema }), portalLogin);
router.get('/me', protect, portalMe);
router.get('/transactions', protect, portalTransactions);
router.get('/loans', protect, portalLoans);

export default router;