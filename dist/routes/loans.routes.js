"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const zodSchemas_1 = require("../utils/zodSchemas");
const loan_controller_1 = require("../controllers/loan.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect, auth_1.managerOnly);
router.get('/', (0, validate_1.validate)({ query: zodSchemas_1.loanQuerySchema }), loan_controller_1.list);
router.post('/', (0, validate_1.validate)({ body: zodSchemas_1.loanCreateSchema }), loan_controller_1.create);
router.get('/:id', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), loan_controller_1.getOne);
router.post('/:id/repay', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema, body: zodSchemas_1.repaymentCreateSchema }), loan_controller_1.repay);
exports.default = router;
//# sourceMappingURL=loans.routes.js.map