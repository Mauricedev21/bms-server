import { Router } from 'express';
import { protect, managerOnly } from '../middleware/auth';
import { validate } from '../utils/validate';
import { updateProfileSchema, salonUpdateSchema } from '../utils/zodSchemas';
import { getDashboard, getSalonSettings, updateSalonSettings, getNotifications, markNotificationsRead, updateProfile } from '../controllers/user.controller';

const router = Router();

router.use(protect);

router.get('/dashboard', managerOnly, getDashboard);
router.get('/notifications', getNotifications);
router.post('/notifications/read', markNotificationsRead);
router.patch('/profile', validate({ body: updateProfileSchema }), updateProfile);

router.get('/salon', managerOnly, getSalonSettings);
router.put('/salon', managerOnly, validate({ body: salonUpdateSchema }), updateSalonSettings);

export default router;