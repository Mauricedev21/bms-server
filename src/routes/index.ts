import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import barberRoutes from './barbers.routes';
import transactionRoutes from './transactions.routes';
import loanRoutes from './loans.routes';
import walletRoutes from './wallet.routes';
import reportRoutes from './reports.routes';
import adminRoutes from './admin.routes';
import barberPortalRoutes from './barberPortal.routes';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', service: 'bms-api', time: new Date().toISOString() } }));

router.use('/auth', authRoutes);
router.use('/portal', barberPortalRoutes);
// userRoutes is mounted at the root (legacy paths used by the e2e script:
// /dashboard, /notifications, /profile, /salon) AND under /user (the paths
// the frontend calls: /user/dashboard, /user/notifications, …).
router.use(userRoutes);
router.use('/user', userRoutes);
router.use('/barbers', barberRoutes);
router.use('/transactions', transactionRoutes);
router.use('/loans', loanRoutes);
router.use('/wallet', walletRoutes);
router.use('/reports', reportRoutes);
router.use('/admin', adminRoutes);

export default router;