import { Router } from 'express';
import { protect, managerOnly } from '../middleware/auth';
import { validate } from '../utils/validate';
import { reportQuerySchema } from '../utils/zodSchemas';
import { generate, list } from '../controllers/report.controller';

const router = Router();
router.use(protect, managerOnly);

router.get('/generate', validate({ query: reportQuerySchema }), generate);
router.get('/', list);

export default router;