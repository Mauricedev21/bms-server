import { Router } from 'express';
import { protect, managerOnly } from '../middleware/auth';
import { financialStatus } from '../controllers/wallet.controller';

const router = Router();
router.use(protect, managerOnly);
router.get('/', financialStatus);

export default router;