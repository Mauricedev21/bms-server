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
exports.portalLoans = exports.portalTransactions = exports.portalMe = exports.portalLogin = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const barberPortal_service_1 = require("../services/barberPortal.service");
const rateLimiter_1 = require("../middleware/rateLimiter");
exports.portalLogin = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const phone = String(req.body.phone ?? '').trim();
    (0, rateLimiter_1.checkLoginAttempts)(phone);
    let token;
    let barber;
    try {
        ({ token, barber } = await barberPortal_service_1.barberPortalService.login(phone, req.body.pin));
    }
    catch (err) {
        if (err instanceof AppError_1.AppError && err.statusCode === 401)
            (0, rateLimiter_1.recordLoginAttempt)(phone);
        throw err;
    }
    (0, rateLimiter_1.clearLoginAttempts)(phone);
    res.json({
        success: true,
        data: {
            token,
            barber: { _id: barber._id, name: barber.name, phone: barber.phone, role: barber.role },
        },
    });
});
exports.portalMe = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const barber = req.barber;
    const summary = await barberPortal_service_1.barberPortalService.summary(String(barber.salon), String(barber._id));
    res.json({
        success: true,
        data: {
            barber: { _id: barber._id, name: barber.name, phone: barber.phone, role: barber.role, salon: barber.salon },
            summary,
        },
    });
});
exports.portalTransactions = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const barber = req.barber;
    const txns = await barberPortal_service_1.barberPortalService.myTransactions(String(barber.salon), String(barber._id));
    res.json({ success: true, data: { transactions: txns } });
});
exports.portalLoans = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const barber = req.barber;
    const { Loan } = await Promise.resolve().then(() => __importStar(require('../models/Loan')));
    const { LoanRepayment } = await Promise.resolve().then(() => __importStar(require('../models/LoanRepayment')));
    const loans = await Loan.find({ salon: barber.salon, barber: barber._id }).sort({ createdAt: -1 }).lean();
    const repayments = await LoanRepayment.find({ salon: barber.salon, barber: barber._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: { loans, repayments } });
});
//# sourceMappingURL=barberPortal.controller.js.map