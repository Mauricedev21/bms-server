import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { generateReport, listReports, type ReportType } from '../services/report.service';

export const generate = asyncHandler(async (req: Request, res: Response) => {
  const type = req.query.type as ReportType;
  const { report, csv } = await generateReport(String(req.salon!._id), type, {
    date: req.query.date as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    generatedBy: String(req.reqUser!._id),
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

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await listReports(String(req.salon!._id), {
    type: req.query.type as string | undefined,
    page: Number(req.query.page ?? 1),
    limit: Number(req.query.limit ?? 20),
  });
  res.json({ success: true, data: result });
});