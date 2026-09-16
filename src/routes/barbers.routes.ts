import { Router } from 'express';
import { protect, managerOnly } from '../middleware/auth';
import { validate } from '../utils/validate';
import { idParamSchema, barberCreateSchema, barberUpdateSchema } from '../utils/zodSchemas';
import {
  list,
  getOne,
  create,
  update,
  remove,
  generatePin,
  payout,
} from '../controllers/barber.controller';

const router = Router();

router.use(protect, managerOnly);

router.get('/', list);
router.post('/', validate({ body: barberCreateSchema }), create);

router.get('/:id', validate({ params: idParamSchema }), getOne);
router.patch('/:id', validate({ params: idParamSchema, body: barberUpdateSchema }), update);
router.delete('/:id', validate({ params: idParamSchema }), remove);

router.post('/:id/pin', validate({ params: idParamSchema }), generatePin);
router.post('/:id/payout', validate({ params: idParamSchema }), payout);

export default router;