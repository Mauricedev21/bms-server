import { Router } from 'express';
import { protect, managerOnly } from '../middleware/auth';
import { validate } from '../utils/validate';
import { loanCreateSchema, repaymentCreateSchema, loanQuerySchema, idParamSchema } from '../utils/zodSchemas';
import { list, create, getOne, repay } from '../controllers/loan.controller';

const router = Router();

router.use(protect, managerOnly);

router.get('/', validate({ query: loanQuerySchema }), list);
router.post('/', validate({ body: loanCreateSchema }), create);

router.get('/:id', validate({ params: idParamSchema }), getOne);
router.post('/:id/repay', validate({ params: idParamSchema, body: repaymentCreateSchema }), repay);

export default router;