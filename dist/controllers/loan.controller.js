"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repay = exports.getOne = exports.create = exports.list = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const loan_service_1 = require("../services/loan.service");
const wallet_service_1 = require("../services/wallet.service");
exports.list = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, loan_service_1.listLoans)(String(req.salon._id), {
        barber: req.query.barber,
        status: req.query.status,
        page: Number(req.query.page ?? 1),
        limit: Number(req.query.limit ?? 20),
    });
    res.json({ success: true, data: result });
});
exports.create = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const loan = await (0, loan_service_1.createLoan)(String(req.salon._id), req.body.barber, req.body.amount, req.body.reason ?? '', String(req.reqUser._id));
    const walletSummary = await (0, wallet_service_1.refreshWallet)(String(req.salon._id));
    res.status(201).json({ success: true, data: { loan, walletSummary } });
});
exports.getOne = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, loan_service_1.getLoan)(String(req.salon._id), req.params.id);
    res.json({ success: true, data: result });
});
exports.repay = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, loan_service_1.recordRepayment)(String(req.salon._id), req.params.id, req.body.amount, req.body.method ?? 'cash', req.body.remark ?? '', String(req.reqUser._id));
    const walletSummary = await (0, wallet_service_1.refreshWallet)(String(req.salon._id));
    res.json({ success: true, data: { ...result, walletSummary } });
});
//# sourceMappingURL=loan.controller.js.map