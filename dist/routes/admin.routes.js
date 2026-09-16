"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const zodSchemas_1 = require("../utils/zodSchemas");
const admin_controller_1 = require("../controllers/admin.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect, auth_1.adminOnly);
router.get('/dashboard', admin_controller_1.dashboard);
router.get('/users', admin_controller_1.listUsers);
router.post('/users', (0, validate_1.validate)({ body: zodSchemas_1.adminCreateUserSchema }), admin_controller_1.createManager);
router.patch('/users/:id/status', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema, body: zodSchemas_1.adminStatusSchema }), admin_controller_1.updateUserStatus);
router.post('/users/:id/renew', (0, validate_1.validate)({ params: zodSchemas_1.idParamSchema }), admin_controller_1.renewUser);
router.post('/retention/run', admin_controller_1.runRetention);
router.post('/notifications/refresh', admin_controller_1.refreshNotifications);
router.get('/activity', admin_controller_1.recentActivity);
exports.default = router;
//# sourceMappingURL=admin.routes.js.map