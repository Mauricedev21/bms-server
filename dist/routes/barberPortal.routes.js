"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rateLimiter_1 = require("../middleware/rateLimiter");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const zodSchemas_1 = require("../utils/zodSchemas");
const barberPortal_controller_1 = require("../controllers/barberPortal.controller");
const router = (0, express_1.Router)();
router.post('/login', rateLimiter_1.authLimiter, (0, validate_1.validate)({ body: zodSchemas_1.barberLoginSchema }), barberPortal_controller_1.portalLogin);
router.get('/me', auth_1.protect, barberPortal_controller_1.portalMe);
router.get('/transactions', auth_1.protect, barberPortal_controller_1.portalTransactions);
router.get('/loans', auth_1.protect, barberPortal_controller_1.portalLoans);
exports.default = router;
//# sourceMappingURL=barberPortal.routes.js.map