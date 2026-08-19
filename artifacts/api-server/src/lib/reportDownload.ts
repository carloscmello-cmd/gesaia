import type { PdfDiagnosticIndicators } from "./generatePdfReport.ts";

type SavedFullDiagnosticContent = {
  period?: unknown;
  diagnosticIndicators?: unknown;
};

/**
 * Old saved diagnostics predate the detailed indicator payload. Recalculate
 * only those incomplete records so a download reflects the report's period
 * while newer saved reports retain their original detailed results.
 */
export function hasSavedDiagnosticIndicators(value: unknown): value is PdfDiagnosticIndicators {
  if (!value || typeof value !== "object") return false;
  const indicators = value as Record<string, unknown>;
  return ["commercial", "marketing", "operations", "hr", "risks"]
    .some((engine) => engine in indicators);
}

export async function resolveDiagnosticIndicatorsForDownload(
  content: SavedFullDiagnosticContent,
  computeForPeriod: (period: string) => Promise<PdfDiagnosticIndicators | null>,
): Promise<PdfDiagnosticIndicators | null> {
  if (hasSavedDiagnosticIndicators(content.diagnosticIndicators)) {
    return content.diagnosticIndicators;
  }

  return typeof content.period === "string" && content.period.length > 0
    ? computeForPeriod(content.period)
    : null;
}