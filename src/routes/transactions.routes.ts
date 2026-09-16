import { Router } from 'express';
import { protect, managerOnly } from '../middleware/auth';
import { validate } from '../utils/validate';
import { transactionCreateSchema, transactionQuerySchema, idParamSchema } from '../utils/zodSchemas';
import { create, list, getOne, remove } from '../controllers/transaction.controller';

const router = Router();

router.use(protect, managerOnly);

router.post('/', validate({ body: transactionCreateSchema }), create);
router.get('/', validate({ query: transactionQuerySchema }), list);

router.get('/:id', validate({ params: idParamSchema }), getOne);
router.delete('/:id', validate({ params: idParamSchema }), remove);

export default router;