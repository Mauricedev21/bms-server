"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../utils/validate");
const zodSchemas_1 = require("../utils/zodSchemas");
const report_controller_1 = require("../controllers/report.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect, auth_1.managerOnly);
router.get('/generate', (0, validate_1.validate)({ query: zodSchemas_1.reportQuerySchema }), report_controller_1.generate);
router.get('/', report_controller_1.list);
exports.default = router;
//# sourceMappingURL=reports.routes.js.map