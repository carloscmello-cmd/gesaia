import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { companies, reports, companyData } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import {
  buildPdfDiagnosticIndicators,
  generatePdfReport,
  type PdfDiagnosticIndicators,
} from "../lib/generatePdfReport";
import { createReportDownloadHandler } from "../lib/reportDownloadHandler";
import {
  persistReportExport,
  type ReportExportRecord,
} from "../lib/reportExportIdempotency";
import { runEngines } from "./calculations";
import type {
  PdfFinancialIndicators,
  PdfScoreThresholds,
} from "../lib/generatePdfReport";

const router = Router();

// ── GET /api/reports/:companyId/reports ──────────────────────────────────────
router.get("/:companyId/reports", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const companyId = Number(req.params.companyId);
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role !== "admin" && company.ownerId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db.select().from(reports).where(eq(reports.companyId, companyId)).orderBy(desc(reports.createdAt));
  res.json(rows.map((r) => ({ id: r.id, companyId: r.companyId, title: r.title, type: r.type, content: r.content, createdAt: r.createdAt })));
});

// ── DELETE /api/reports/:companyId/reports/:reportId ─────────────────────────
router.delete("/:companyId/reports/:reportId", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const companyId = Number(req.params.companyId);
  const reportId = Number(req.params.reportId);

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role !== "admin" && company.ownerId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report || report.companyId !== companyId) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(reports).where(eq(reports.id, reportId));
  res.status(204).send();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute the four financial KPIs for a given company/period from stored data. */
async function computeFinancialIndicators(cId: number, period: string): Promise<PdfFinancialIndicators | null> {
  const [dataRow] = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, cId), eq(companyData.period, period)))
    .limit(1);
  if (!dataRow) return null;
  const results = runEngines(["financial"], dataRow) as { financial?: Record<string, unknown> };
  const fin = results.financial ?? {};
  const toN = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  return {
    contributionMargin: toN(fin.contributionMargin),
    breakEvenRevenue: toN(fin.breakEvenRevenue),
    safetyMargin: toN(fin.safetyMargin),
    safetyMarginClass: typeof fin.safetyMarginClass === "string" ? fin.safetyMarginClass : null,
    cashCycle: toN(fin.cashCycle),
  };
}

async function computeDiagnosticIndicators(
  companyId: number,
  period: string,
): Promise<PdfDiagnosticIndicators | null> {
  const [dataRow] = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, companyId), eq(companyData.period, period)))
    .limit(1);
  if (!dataRow) return null;
  return buildPdfDiagnosticIndicators(runEngines(
    ["commercial", "marketing", "operations", "hr", "risks"],
    dataRow,
  ));
}

// ── GET /api/reports/:id/download ────────────────────────────────────────────
router.get("/:id/download", requireAuth, createReportDownloadHandler({
  async findReport(reportId) {
    const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
    return report ? { ...report, content: report.content as Record<string, any> } : null;
  },
  async findCompany(companyId) {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    return company ?? null;
  },
  computeFinancialIndicators,
  computeDiagnosticIndicators,
  generatePdfReport,
}));

// ── POST /api/reports/pdf — save report + generate and stream PDF ─────────────
router.post("/pdf", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const idempotencyKey = req.get("Idempotency-Key")?.trim() || null;
  const {
    companyId,
    companyName,
    segment,
    activity,
    businessModel,
    period,
    generatedAt,
    kpis,
    alerts,
    findings,
    previousFindings,
    blufRecommendation,
  } = req.body;

  if (!companyId || !companyName) {
    res.status(400).json({ error: "companyId and companyName are required" });
    return;
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (user.role !== "admin" && company.ownerId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  // Compute financial indicators server-side from stored period data
  const financialIndicators = period
    ? await computeFinancialIndicators(companyId, period)
    : null;

  // Persist report record to DB. A key is generated by the web client for one
  // export attempt and is retained when the response is lost, allowing the
  // retry to reuse this report instead of creating a second history row.
  const title = `Relatório Gerencial — ${companyName}${period ? ` (${period})` : ""}`;
  const reportContent = {
    companyName,
    segment,
    activity,
    businessModel,
    period,
    generatedAt,
    kpis: kpis ?? [],
    alerts: alerts ?? [],
    findings: findings ?? [],
    previousFindings: previousFindings ?? [],
    blufRecommendation: blufRecommendation ?? null,
    financialIndicators: financialIndicators ?? null,
    scoreThresholds: company.scoreThresholds ?? null,
  };
  const persisted = await persistReportExport({
    companyId,
    title,
    type: "full_analysis",
    content: reportContent,
    idempotencyKey,
  }, {
    async findByIdempotencyKey(key): Promise<ReportExportRecord | null> {
      const [report] = await db.select().from(reports)
        .where(eq(reports.idempotencyKey, key))
        .limit(1);
      return report
        ? {
            id: report.id,
            companyId: report.companyId,
            content: report.content as Record<string, unknown>,
            createdAt: report.createdAt,
          }
        : null;
    },
    async insert(values): Promise<ReportExportRecord | null> {
      const [report] = await db.insert(reports)
        .values(values)
        .onConflictDoNothing({ target: reports.idempotencyKey })
        .returning();
      return report
        ? {
            id: report.id,
            companyId: report.companyId,
            content: report.content as Record<string, unknown>,
            createdAt: report.createdAt,
          }
        : null;
    },
  });

  const savedContent = persisted.report.content;

  // Generate PDF server-side
  const pdfBuffer = await generatePdfReport({
    companyName: String(savedContent.companyName ?? companyName),
    segment: String(savedContent.segment ?? company.segment ?? ""),
    activity: String(savedContent.activity ?? company.activity ?? ""),
    businessModel: String(savedContent.businessModel ?? company.businessModel ?? ""),
    period: typeof savedContent.period === "string" ? savedContent.period : undefined,
    generatedAt: String(savedContent.generatedAt ?? new Date().toLocaleString("pt-BR")),
    kpis: Array.isArray(savedContent.kpis) ? savedContent.kpis as any[] : [],
    alerts: Array.isArray(savedContent.alerts) ? savedContent.alerts as any[] : [],
    findings: Array.isArray(savedContent.findings) ? savedContent.findings as any[] : [],
    previousFindings: Array.isArray(savedContent.previousFindings)
      ? savedContent.previousFindings as any[]
      : [],
    blufRecommendation: typeof savedContent.blufRecommendation === "string"
      ? savedContent.blufRecommendation
      : undefined,
    financialIndicators: savedContent.financialIndicators as PdfFinancialIndicators | null | undefined,
    scoreThresholds: savedContent.scoreThresholds as PdfScoreThresholds | null | undefined,
  });

  const filename = `GESAIA_${companyName.replace(/\s+/g, "_")}${period ? `_${period}` : ""}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.send(pdfBuffer);
});

// ── DELETE /api/reports/:id ───────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const reportId = Number(req.params.id);

  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  const [company] = await db.select().from(companies).where(eq(companies.id, report.companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (user.role !== "admin" && company.ownerId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(reports).where(eq(reports.id, reportId));
  res.status(204).send();
});

export default router;
