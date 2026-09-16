"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = exports.generate = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const report_service_1 = require("../services/report.service");
exports.generate = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const type = req.query.type;
    const { report, csv } = await (0, report_service_1.generateReport)(String(req.salon._id), type, {
        date: req.query.date,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        generatedBy: String(req.reqUser._id),
    });
    const wantDownload = req.query.download === 'true';
    if (wantDownload) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="report-${type}-${Date.now()}.csv"`);
        res.status(200).send(csv);
        return;
    }
    res.json({ success: true, data: { report, csv } });
});
exports.list = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, report_service_1.listReports)(String(req.salon._id), {
        type: req.query.type,
        page: Number(req.query.page ?? 1),
        limit: Number(req.query.limit ?? 20),
    });
    res.json({ success: true, data: result });
});
//# sourceMappingURL=report.controller.js.map