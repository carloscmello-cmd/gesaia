export function getReportSummary(content: Record<string, unknown>): string {
  const period =
    typeof content.period === "string" && content.period.trim()
      ? content.period.trim()
      : "Período não informado";
  const kpiCount = Array.isArray(content.kpis) ? content.kpis.length : 0;
  const findingCount = Array.isArray(content.findings)
    ? content.findings.length
    : 0;
  const bluf =
    typeof content.blufRecommendation === "string"
      ? content.blufRecommendation.replace(/\s+/g, " ").trim()
      : "";
  const blufPreview =
    bluf.length > 80 ? `${bluf.slice(0, 77).trimEnd()}…` : bluf;

  return `${period} · ${kpiCount} ${kpiCount === 1 ? "KPI" : "KPIs"} · ${findingCount} ${
    findingCount === 1 ? "achado" : "achados"
  }${blufPreview ? ` · ${blufPreview}` : ""}`;
}
