"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.financialStatus = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const wallet_service_1 = require("../services/wallet.service");
exports.financialStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const salonId = String(req.salon._id);
    const force = req.query.force === 'true';
    const wallet = force ? await (0, wallet_service_1.recomputeWallet)(salonId) : await (0, wallet_service_1.getWallet)(salonId);
    const recentPayouts = await Promise.resolve().then(() => __importStar(require('../models/Payment'))).then((m) => m.Payment.find({ salon: salonId, type: 'barber_payout' }).sort({ createdAt: -1 }).limit(10).populate('barber', 'name').lean());
    res.json({ success: true, data: { wallet, recentPayouts } });
});
//# sourceMappingURL=wallet.controller.js.map