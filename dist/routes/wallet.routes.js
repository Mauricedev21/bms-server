"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const wallet_controller_1 = require("../controllers/wallet.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect, auth_1.managerOnly);
router.get('/', wallet_controller_1.financialStatus);
exports.default = router;
//# sourceMappingURL=wallet.routes.js.map