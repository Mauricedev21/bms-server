"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const zodSchemas_1 = require("../utils/zodSchemas");
const transaction_controller_1 = require("../controllers/transaction.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect, auth_1.managerOnly);
router.post('/', (0, validate_1.validate)({ body: zodSchemas_1.transactionCreateSchema }), transaction_controller_1.create);
router.get('/', (0, validate_1.validate)({ query: zodSchemas_1.transactionQuerySchema }), transaction_controller_1.list);
router.get('/:id', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), transaction_controller_1.getOne);
router.delete('/:id', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), transaction_controller_1.remove);
exports.default = router;
//# sourceMappingURL=transactions.routes.js.map