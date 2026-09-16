"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payout = exports.generatePin = exports.remove = exports.update = exports.create = exports.getOne = exports.list = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const barber_service_1 = require("../services/barber.service");
const transaction_service_1 = require("../services/transaction.service");
const wallet_service_1 = require("../services/wallet.service");
exports.list = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const barbers = await (0, barber_service_1.listBarbers)(String(req.salon._id), {
        search: req.query.search,
        status: req.query.status,
    });
    const wallet = await (0, wallet_service_1.refreshWallet)(String(req.salon._id));
    res.json({ success: true, data: { barbers, walletSummary: wallet } });
});
exports.getOne = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, barber_service_1.getBarber)(String(req.salon._id), req.params.id);
    res.json({ success: true, data: result });
});
exports.create = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const barber = await (0, barber_service_1.createBarber)(String(req.salon._id), req.body);
    res.status(201).json({ success: true, data: { barber } });
});
exports.update = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const barber = await (0, barber_service_1.updateBarber)(String(req.salon._id), req.params.id, req.body);
    res.json({ success: true, data: { barber } });
});
exports.remove = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, barber_service_1.deleteBarber)(String(req.salon._id), req.params.id);
    res.json({ success: true, data: { message: 'Barber removed.' } });
});
exports.generatePin = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const pin = await (0, barber_service_1.setBarberPin)(String(req.salon._id), req.params.id, req.body.pin);
    res.json({ success: true, data: { pin } });
});
exports.payout = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const amount = typeof req.body.amount === 'number' && Number.isFinite(req.body.amount) ? req.body.amount : undefined;
    if (amount !== undefined && amount <= 0) {
        throw AppError_1.AppError.badRequest('Invalid payout amount.');
    }
    const result = await (0, transaction_service_1.recordBarberPayout)(String(req.salon._id), req.params.id, amount, req.body.method ?? 'cash', String(req.reqUser._id));
    const wallet = await (0, wallet_service_1.refreshWallet)(String(req.salon._id));
    res.status(201).json({ success: true, data: { ...result, walletSummary: wallet } });
});
//# sourceMappingURL=barber.controller.js.map