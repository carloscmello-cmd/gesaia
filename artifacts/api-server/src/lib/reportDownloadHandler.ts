import type { Request, Response } from "express";
import {
  generateFullDiagnosticPdf,
  generatePdfReport,
  type PdfDiagnosticIndicators,
  type PdfFinancialIndicators,
} from "./generatePdfReport.ts";
import { resolveDiagnosticIndicatorsForDownload } from "./reportDownload.ts";

type ReportContent = Record<string, any>;

interface DownloadReport {
  companyId: number;
  content: ReportContent;
}

interface DownloadCompany {
  name: string;
  ownerId: number;
  segment?: string | null;
  activity?: string | null;
  businessModel?: string | null;
  scoreThresholds?: { greenMin: number; yellowMin: number } | null;
}

export interface ReportDownloadDependencies {
  findReport(reportId: number): Promise<DownloadReport | null>;
  findCompany(companyId: number): Promise<DownloadCompany | null>;
  computeFinancialIndicators(companyId: number, period: string): Promise<PdfFinancialIndicators | null>;
  computeDiagnosticIndicators(companyId: number, period: string): Promise<PdfDiagnosticIndicators | null>;
  generateFullDiagnosticPdf?: typeof generateFullDiagnosticPdf;
  generatePdfReport?: typeof generatePdfReport;
}

/**
 * Creates the handler mounted at GET /api/reports/:id/download.
 * Its dependencies are supplied by the route so the saved-report shape and
 * the generated PDF can be exercised without a database connection.
 */
export function createReportDownloadHandler(dependencies: ReportDownloadDependencies) {
  const renderFullDiagnostic = dependencies.generateFullDiagnosticPdf ?? generateFullDiagnosticPdf;
  const renderStandardReport = dependencies.generatePdfReport ?? generatePdfReport;

  return async (req: Request, res: Response) => {
    const user = (req as any).dbUser;
    const reportId = Number(req.params.id);
    const report = await dependencies.findReport(reportId);
    if (!report) { res.status(404).json({ error: "Not found" }); return; }

    const company = await dependencies.findCompany(report.companyId);
    if (!company) { res.status(404).json({ error: "Company not found" }); return; }
    if (user.role !== "admin" && company.ownerId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

    const content = report.content;

    if (content.reportKind === "full_diagnostic") {
      let financialIndicators = content.financialIndicators ?? null;
      if (!financialIndicators && content.period) {
        financialIndicators = await dependencies.computeFinancialIndicators(report.companyId, content.period);
      }

      const diagnosticIndicators = await resolveDiagnosticIndicatorsForDownload(
        content,
        (period) => dependencies.computeDiagnosticIndicators(report.companyId, period),
      );

      const pdfBuffer = await renderFullDiagnostic({
        companyName: content.companyName ?? company.name,
        period: content.period,
        sector: content.sector,
        generatedAt: content.generatedAt ?? new Date().toLocaleString("pt-BR"),
        financialIndicators: financialIndicators ?? undefined,
        missingFields: content.missingFields,
        blufRecommendation: content.blufRecommendation ?? null,
        diagnosticIndicators: diagnosticIndicators ?? undefined,
        scorecard: {
          indicators: content.scorecard?.indicators ?? [],
          engines: content.scorecard?.engines ?? [],
        },
        narrative: content.narrative ?? null,
      });

      const filename = `GESAIA_${(content.companyName ?? company.name).replace(/\s+/g, "_")}_Diagnostico_Completo${content.period ? `_${content.period}` : ""}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
      return;
    }

    let financialIndicators = content.financialIndicators ?? null;
    if (!financialIndicators && content.period) {
      financialIndicators = await dependencies.computeFinancialIndicators(report.companyId, content.period);
    }

    const pdfBuffer = await renderStandardReport({
      companyName: content.companyName ?? company.name,
      segment: content.segment ?? company.segment ?? "",
      activity: content.activity ?? company.activity ?? "",
      businessModel: content.businessModel ?? company.businessModel ?? "",
      period: content.period,
      generatedAt: content.generatedAt ?? new Date().toLocaleString("pt-BR"),
      kpis: content.kpis ?? [],
      alerts: content.alerts ?? [],
      findings: content.findings ?? [],
      previousFindings: content.previousFindings ?? [],
      blufRecommendation: content.blufRecommendation ?? null,
      financialIndicators: financialIndicators ?? undefined,
      scoreThresholds: company.scoreThresholds ?? undefined,
    });

    const filename = `GESAIA_${(content.companyName ?? company.name).replace(/\s+/g, "_")}${content.period ? `_${content.period}` : ""}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  };
}