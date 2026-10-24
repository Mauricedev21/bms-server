import { Router } from 'express';
import { protect, adminOnly } from '../middleware/auth';
import { validate } from '../utils/validate';
import { adminStatusSchema, adminCreateUserSchema, idParamSchema } from '../utils/zodSchemas';
import {
  dashboard,
  listUsers,
  createManager,
  approveUser,
  rejectUser,
  updateUserStatus,
  renewUser,
  runRetention,
  refreshNotifications,
  recentActivity,
  storageUsage,
} from '../controllers/admin.controller';

const router = Router();
router.use(protect, adminOnly);

router.get('/dashboard', dashboard);
router.get('/users', listUsers);
router.post('/users', validate({ body: adminCreateUserSchema }), createManager);
router.post('/users/:id/approve', validate({ params: idParamSchema }), approveUser);
router.post('/users/:id/reject', validate({ params: idParamSchema }), rejectUser);
router.patch('/users/:id/status', validate({ params: idParamSchema, body: adminStatusSchema }), updateUserStatus);
router.post('/users/:id/renew', validate({ params: idParamSchema }), renewUser);

router.post('/retention/run', runRetention);
router.post('/notifications/refresh', refreshNotifications);
router.get('/activity', recentActivity);
router.get('/storage', storageUsage);

export default router;