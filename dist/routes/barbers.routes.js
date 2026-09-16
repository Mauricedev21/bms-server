"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const zodSchemas_1 = require("../utils/zodSchemas");
const barber_controller_1 = require("../controllers/barber.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect, auth_1.managerOnly);
router.get('/', barber_controller_1.list);
router.post('/', (0, validate_1.validate)({ body: zodSchemas_1.barberCreateSchema }), barber_controller_1.create);
router.get('/:id', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), barber_controller_1.getOne);
router.patch('/:id', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema, body: zodSchemas_1.barberUpdateSchema }), barber_controller_1.update);
router.delete('/:id', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), barber_controller_1.remove);
router.post('/:id/pin', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), barber_controller_1.generatePin);
router.post('/:id/payout', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), barber_controller_1.payout);
exports.default = router;
//# sourceMappingURL=barbers.routes.js.map