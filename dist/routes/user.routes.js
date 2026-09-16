"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const zodSchemas_1 = require("../utils/zodSchemas");
const user_controller_1 = require("../controllers/user.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect);
router.get('/dashboard', auth_1.managerOnly, user_controller_1.getDashboard);
router.get('/notifications', user_controller_1.getNotifications);
router.post('/notifications/read', user_controller_1.markNotificationsRead);
router.patch('/profile', (0, validate_1.validate)({ body: zodSchemas_1.updateProfileSchema }), user_controller_1.updateProfile);
router.get('/salon', auth_1.managerOnly, user_controller_1.getSalonSettings);
router.put('/salon', auth_1.managerOnly, (0, validate_1.validate)({ body: zodSchemas_1.salonUpdateSchema }), user_controller_1.updateSalonSettings);
exports.default = router;
//# sourceMappingURL=user.routes.js.map