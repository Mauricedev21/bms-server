"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInputGuard = exports.remove = exports.getOne = exports.list = exports.create = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const transaction_service_1 = require("../services/transaction.service");
const dashboard_service_1 = require("../services/dashboard.service");
const wallet_service_1 = require("../services/wallet.service");
exports.create = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const salonId = String(req.salon._id);
    const txn = await (0, transaction_service_1.createTransaction)({
        salonId,
        barberId: req.body.barber,
        totalAmount: req.body.totalAmount,
        paymentMethod: req.body.paymentMethod,
        customerName: req.body.customerName,
        service: req.body.service,
        description: req.body.description,
        clientRefId: req.body.clientRefId,
        recordedBy: String(req.reqUser._id),
    });
    // Updated dashboard totals returned atomically with the new transaction.
    const [walletSummary, dashboard] = await Promise.all([
        (0, wallet_service_1.refreshWallet)(salonId),
        (0, dashboard_service_1.computeDashboardSummary)(salonId, true),
    ]);
    res.status(201).json({ success: true, data: { transaction: txn, walletSummary, dashboard } });
});
exports.list = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, transaction_service_1.listTransactions)({
        salonId: String(req.salon._id),
        barber: req.query.barber,
        paymentMethod: req.query.paymentMethod,
        status: req.query.status,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search,
        page: Number(req.query.page ?? 1),
        limit: Number(req.query.limit ?? 20),
    });
    res.json({ success: true, data: result });
});
exports.getOne = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const txn = await (0, transaction_service_1.getTransaction)(String(req.salon._id), req.params.id);
    res.json({ success: true, data: { transaction: txn } });
});
exports.remove = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const reason = String(req.body.reason ?? '');
    const txn = await (0, transaction_service_1.voidTransaction)(String(req.salon._id), req.params.id, reason);
    const walletSummary = await (0, wallet_service_1.refreshWallet)(String(req.salon._id));
    res.json({ success: true, data: { transaction: txn, message: 'Transaction voided.', walletSummary } });
});
exports.createInputGuard = (0, asyncHandler_1.asyncHandler)(async (_req, _res) => {
    throw AppError_1.AppError.badRequest('Use POST /transactions to record a transaction.');
});
//# sourceMappingURL=transaction.controller.js.map