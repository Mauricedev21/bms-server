"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_routes_1 = __importDefault(require("./auth.routes"));
const user_routes_1 = __importDefault(require("./user.routes"));
const barbers_routes_1 = __importDefault(require("./barbers.routes"));
const transactions_routes_1 = __importDefault(require("./transactions.routes"));
const loans_routes_1 = __importDefault(require("./loans.routes"));
const wallet_routes_1 = __importDefault(require("./wallet.routes"));
const reports_routes_1 = __importDefault(require("./reports.routes"));
const admin_routes_1 = __importDefault(require("./admin.routes"));
const barberPortal_routes_1 = __importDefault(require("./barberPortal.routes"));
const router = (0, express_1.Router)();
router.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', service: 'bms-api', time: new Date().toISOString() } }));
router.use('/auth', auth_routes_1.default);
router.use('/portal', barberPortal_routes_1.default);
// userRoutes is mounted at the root (legacy paths used by the e2e script:
// /dashboard, /notifications, /profile, /salon) AND under /user (the paths
// the frontend calls: /user/dashboard, /user/notifications, …).
router.use(user_routes_1.default);
router.use('/user', user_routes_1.default);
router.use('/barbers', barbers_routes_1.default);
router.use('/transactions', transactions_routes_1.default);
router.use('/loans', loans_routes_1.default);
router.use('/wallet', wallet_routes_1.default);
router.use('/reports', reports_routes_1.default);
router.use('/admin', admin_routes_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map