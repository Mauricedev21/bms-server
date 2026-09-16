"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rateLimiter_1 = require("../middleware/rateLimiter");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const AppError_1 = require("../utils/AppError");
const zodSchemas_1 = require("../utils/zodSchemas");
const auth_controller_1 = require("../controllers/auth.controller");
const env_1 = require("../config/env");
const router = (0, express_1.Router)();
/** Admissions gate — registration can be turned off in production. */
const registrationEnabled = (_req, _res, next) => {
    if (!env_1.env.ALLOW_REGISTRATION) {
        return next(AppError_1.AppError.forbidden('Registration is currently disabled.'));
    }
    next();
};
router.post('/register', rateLimiter_1.authLimiter, registrationEnabled, (0, validate_1.validate)({ body: zodSchemas_1.registerSchema }), auth_controller_1.register);
router.post('/login', rateLimiter_1.authLimiter, (0, validate_1.validate)({ body: zodSchemas_1.loginSchema }), auth_controller_1.login);
router.get('/me', auth_1.protect, auth_controller_1.me);
router.post('/logout', auth_1.protect, auth_controller_1.logout);
router.post('/change-password', auth_1.protect, (0, validate_1.validate)({ body: zodSchemas_1.changePasswordSchema }), auth_controller_1.changePassword);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map