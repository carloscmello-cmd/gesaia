/**
 * Server-side PDF generation using @react-pdf/renderer.
 * Uses React.createElement (no JSX) so no tsconfig changes are needed.
 */
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
  Font,
} from "@react-pdf/renderer";
import {
  buildPriorityBluf,
  resolveScoreThresholds,
  scorePriority,
  type ScoreThresholds,
} from "./scoreThresholds.ts";

export interface PdfKpi {
  label: string;
  value: string;
  status: string;
}

export interface PdfAlert {
  message: string;
  severity: string;
  engine: string;
}

export interface PdfFinding {
  engine: string;
  title: string;
  impact: string;
  summary: string;
  score?: number | null;
}

export interface PdfFinancialIndicators {
  contributionMargin?: number | null;
  breakEvenRevenue?: number | null;
  safetyMargin?: number | null;
  safetyMarginClass?: string | null;
  cashCycle?: number | null;
}

export type PdfScoreThresholds = ScoreThresholds;

export interface PdfReportData {
  companyName: string;
  segment: string;
  activity: string;
  businessModel: string;
  period?: string;
  generatedAt: string;
  kpis?: PdfKpi[];
  alerts?: PdfAlert[];
  findings?: PdfFinding[];
  previousFindings?: PdfFinding[];
  blufRecommendation?: string;
  financialIndicators?: PdfFinancialIndicators | null;
  scoreThresholds?: PdfScoreThresholds | null;
}

export interface PdfFullDiagnosticScoreItem {
  key?: string;
  label: string;
  /** Stable engine key used to group indicators in the full diagnostic scorecard. */
  engine?: string;
  unit?: string;
  value?: number | null;
  score?: number | null;
  level?: number | null;
  levelLabel?: string | null;
}

export interface PdfFullDiagnosticNarrativeSection {
  title: string;
  narrative: string;
  causes?: string[];
  suggestions?: { action: string; expectedImpact?: string }[];
}

export interface PdfFullDiagnosticData {
  companyName: string;
  period?: string;
  sector?: string;
  generatedAt: string;
  financialIndicators?: PdfFinancialIndicators | null;
  missingFields?: string[];
  blufRecommendation?: string | null;
  diagnosticIndicators?: PdfDiagnosticIndicators | null;
  scorecard: {
    indicators?: PdfFullDiagnosticScoreItem[];
    engines?: PdfFullDiagnosticScoreItem[];
  };
  narrative?: {
    executiveSummary?: string;
    sections?: PdfFullDiagnosticNarrativeSection[];
    nextSteps?: string;
  } | null;
}

export interface PdfDiagnosticCommercialIndicators {
  cac?: number | null;
  ltv?: number | null;
  ltvCacRatio?: number | null;
  ltvCacClassification?: string | null;
}
const IMPACT_LABELS: Record<string, string> = {
  high: "Alta Prioridade",
  medium: "Média Prioridade",
  low: "Boa Performance",
};

const STATUS_LABELS: Record<string, string> = {
  good: "Bom",
  warning: "Atenção",
  critical: "Crítico",
  neutral: "Neutro",
};

const DIAGNOSTIC_LEVEL_LABELS = ["Crítico", "Ruim", "Aceitável", "Bom", "Excelente"];

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 0,
    paddingBottom: 30,
    paddingHorizontal: 0,
    color: "#1e1e1e",
  },
  fullDiagnosticPage: {
    paddingTop: 92,
  },
  fullDiagnosticHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  // Header
  header: {
    backgroundColor: "#0f3460",
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: { flexDirection: "column" },
  headerRight: { flexDirection: "column", alignItems: "flex-end" },
  headerTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  headerSubtitle: { fontSize: 8, color: "#c0cfe0", marginTop: 2 },
  headerLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  headerContext: {
    fontSize: 8,
    color: "#ffffff",
    marginTop: 2,
    maxWidth: 240,
    textAlign: "right",
  },
  headerDate: { fontSize: 8, color: "#c0cfe0", marginTop: 2 },
  // Body
  body: { paddingHorizontal: 20, paddingTop: 16 },
  companyName: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: "#0f3460",
    marginBottom: 4,
  },
  companyMeta: { fontSize: 8, color: "#666666", marginBottom: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#e0e0e0", marginBottom: 12 },
  // Section
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0f3460",
    marginBottom: 6,
    marginTop: 12,
  },
  // BLUF box
  blufBox: {
    backgroundColor: "#eff6ff",
    borderLeftWidth: 3,
    borderLeftColor: "#3b82f6",
    padding: 10,
    marginBottom: 10,
    borderRadius: 3,
  },
  blufLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#2563eb",
    marginBottom: 4,
  },
  blufText: { fontSize: 8.5, color: "#1e1e1e", lineHeight: 1.4 },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#0f3460",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableHeaderText: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  tableRowAlt: { backgroundColor: "#f5f7fa" },
  tableCell: { fontSize: 8, color: "#1e1e1e" },
  // Column widths for KPIs
  kpiColLabel: { flex: 3 },
  kpiColValue: { flex: 1.5, textAlign: "right" },
  kpiColStatus: { flex: 1.5, textAlign: "center" },
  // Column widths for alerts
  alertColMsg: { flex: 4 },
  alertColEngine: { flex: 2 },
  alertColSev: { flex: 1.5, textAlign: "center" },
  // Column widths for findings
  findColScore: { flex: 1, textAlign: "center" },
  findColTitle: { flex: 2.5 },
  findColPriority: { flex: 2 },
  findColSummary: { flex: 4 },
  // Status badge colours
  statusGood: { color: "#16a34a" },
  statusWarning: { color: "#ca8a04" },
  statusCritical: { color: "#dc2626" },
  // Scorecard section
  scorecardSection: {
    marginBottom: 10,
  },
  // Financial indicators grid
  finGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  finCard: {
    width: "47%",
    borderRadius: 4,
    padding: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  finCardLabel: { fontSize: 7, color: "#6b7280", marginBottom: 2 },
  finCardValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  finCardSub: { fontSize: 7.5, marginTop: 1 },
  finBadge: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginTop: 3,
  },
  // No-analysis placeholder
  noAnalysisBox: {
    backgroundColor: "#fefce8",
    borderLeftWidth: 3,
    borderLeftColor: "#f59e0b",
    padding: 10,
    marginTop: 4,
    borderRadius: 3,
  },
  noAnalysisText: {
    fontSize: 8.5,
    color: "#78350f",
    lineHeight: 1.5,
  },
  // Full diagnostic report
  diagnosticSummaryBox: {
    backgroundColor: "#eff6ff",
    borderLeftWidth: 3,
    borderLeftColor: "#2563eb",
    padding: 10,
    marginBottom: 10,
    borderRadius: 3,
  },
  diagnosticNarrative: {
    fontSize: 8.5,
    color: "#1e1e1e",
    lineHeight: 1.45,
    marginBottom: 6,
  },
  diagnosticSubheading: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    marginTop: 5,
    marginBottom: 3,
  },
  diagnosticBullet: {
    fontSize: 8,
    color: "#1e1e1e",
    lineHeight: 1.35,
    marginBottom: 2,
    paddingLeft: 6,
  },
  diagnosticMissing: {
    backgroundColor: "#fefce8",
    borderLeftWidth: 3,
    borderLeftColor: "#f59e0b",
    padding: 9,
    marginBottom: 10,
    borderRadius: 3,
  },
  diagnosticTableHeader: {
    flexDirection: "row",
    backgroundColor: "#0f3460",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  diagnosticTableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  diagnosticTableRowMuted: {
    backgroundColor: "#f9fafb",
  },
  diagnosticMutedCell: {
    color: "#9ca3af",
  },
  diagnosticGroupHeader: {
    backgroundColor: "#e8eef7",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  diagnosticGroupHeaderText: {
    color: "#1e3a5f",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  diagnosticColLabel: { flex: 3 },
  diagnosticColValue: { flex: 1.2, textAlign: "right" },
  diagnosticColLevel: { flex: 1.8, textAlign: "right" },
  diagnosticIndicatorsSection: {
    marginTop: 2,
    marginBottom: 4,
  },
  diagnosticIndicatorTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#0f3460",
    marginBottom: 5,
  },
  diagnosticIndicatorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 7,
  },
  diagnosticIndicatorCard: {
    width: "31%",
    borderWidth: 1,
    borderColor: "#dbe3ef",
    borderRadius: 4,
    padding: 7,
    marginBottom: 2,
  },
  diagnosticIndicatorLabel: {
    fontSize: 7,
    color: "#6b7280",
    marginBottom: 2,
  },
  diagnosticIndicatorValue: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a5f",
  },
  diagnosticIndicatorBadge: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 7,
    alignSelf: "flex-start",
    marginTop: 3,
  },
  riskColName: { flex: 2.2 },
  riskColProbability: { flex: 1.2, textAlign: "right" },
  riskColImpact: { flex: 1.5, textAlign: "right" },
  riskColLoss: { flex: 1.5, textAlign: "right" },
  riskColExposure: { flex: 1.2, textAlign: "right" },
  // Footer
  footer: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 7,
    color: "#999999",
  },
});

function statusStyle(status: string) {
  if (status === "good") return styles.statusGood;
  if (status === "warning") return styles.statusWarning;
  if (status === "critical") return styles.statusCritical;
  return {};
}

// Safety margin badge colours (matches AnalysisPanel)
const SAFETY_MARGIN_STYLE: Record<string, { bg: string; text: string }> = {
  "Péssimo":   { bg: "#fee2e2", text: "#b91c1c" },
  "Ruim":      { bg: "#ffedd5", text: "#c2410c" },
  "Aceitável": { bg: "#fef9c3", text: "#a16207" },
  "Bom":       { bg: "#dbeafe", text: "#1d4ed8" },
  "Excelente": { bg: "#d1fae5", text: "#065f46" },
};

function buildFinancialIndicatorsSection(fi: PdfFinancialIndicators) {
  const hasAny = fi.contributionMargin != null || fi.breakEvenRevenue != null
    || fi.safetyMargin != null || fi.cashCycle != null;
  if (!hasAny) return null;

  function fmtBrl(v: number | null | undefined) {
    if (v == null) return null;
    return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  }
  function fmtPct(v: number | null | undefined) {
    if (v == null) return null;
    return `${Number(v).toFixed(1)}%`;
  }
  function fmtDays(v: number | null | undefined) {
    if (v == null) return null;
    return `${Math.round(v)} dias`;
  }

  const cards: any[] = [];

  // Margem de Contribuição
  if (fi.contributionMargin != null) {
    cards.push(
      ce(View, { key: "mc", style: [styles.finCard, { backgroundColor: "#ecfdf5", borderColor: "#6ee7b7" }] },
        ce(Text, { style: styles.finCardLabel }, "Margem de Contribuição"),
        ce(Text, { style: [styles.finCardValue, { color: "#065f46" }] }, fmtBrl(fi.contributionMargin) ?? "—"),
      )
    );
  }

  // Ponto de Equilíbrio
  if (fi.breakEvenRevenue != null) {
    cards.push(
      ce(View, { key: "pe", style: [styles.finCard, { backgroundColor: "#eff6ff", borderColor: "#93c5fd" }] },
        ce(Text, { style: styles.finCardLabel }, "Ponto de Equilíbrio"),
        ce(Text, { style: [styles.finCardValue, { color: "#1d4ed8" }] }, fmtBrl(fi.breakEvenRevenue) ?? "—"),
      )
    );
  }

  // Margem de Segurança
  if (fi.safetyMargin != null) {
    const badgeCfg = fi.safetyMarginClass ? SAFETY_MARGIN_STYLE[fi.safetyMarginClass] : null;
    cards.push(
      ce(View, { key: "seg", style: [styles.finCard, { backgroundColor: "#fffbeb", borderColor: "#fcd34d" }] },
        ce(Text, { style: styles.finCardLabel }, "Margem de Segurança"),
        ce(Text, { style: [styles.finCardValue, { color: "#92400e" }] }, fmtPct(fi.safetyMargin) ?? "—"),
        fi.safetyMarginClass && badgeCfg
          ? ce(View, { style: [styles.finBadge, { backgroundColor: badgeCfg.bg }] },
              ce(Text, { style: { fontSize: 7, fontFamily: "Helvetica-Bold", color: badgeCfg.text } }, fi.safetyMarginClass)
            )
          : null,
      )
    );
  }

  // Ciclo de Caixa
  if (fi.cashCycle != null) {
    cards.push(
      ce(View, { key: "cc", style: [styles.finCard, { backgroundColor: "#f5f3ff", borderColor: "#c4b5fd" }] },
        ce(Text, { style: styles.finCardLabel }, "Ciclo de Caixa"),
        ce(Text, { style: [styles.finCardValue, { color: "#5b21b6" }] }, fmtDays(fi.cashCycle) ?? "—"),
      )
    );
  }

  if (cards.length === 0) return null;

  return ce(
    View,
    { style: { marginBottom: 10 } },
    ce(Text, { style: [styles.sectionTitle, { marginTop: 8 }] }, "Indicadores Financeiros"),
    ce(View, { style: styles.finGrid }, ...cards),
  );
}

function severityLabel(s: string) {
  if (s === "high") return "Alta";
  if (s === "medium") return "Média";
  return "Baixa";
}

export function scoreColor(score: number | null | undefined, thresholds: PdfScoreThresholds) {
  if (score == null) return "#9ca3af";
  if (score >= thresholds.greenMin) return "#16a34a";
  if (score >= thresholds.yellowMin) return "#ca8a04";
  return "#dc2626";
}

/**
 * Computes the variation label shown next to each engine bar in the scorecard.
 * Returns null when either score is absent (no previous data → no indicator shown).
 */
export function scorecardDeltaLabel(
  currentScore: number | null | undefined,
  previousScore: number | null | undefined,
): string | null {
  if (currentScore == null || previousScore == null) return null;
  const delta = Math.round(currentScore - previousScore);
  if (delta > 0) return `▲ +${delta}`;
  if (delta < 0) return `▼ ${delta}`;
  return "— 0";
}

export interface ScorecardEngineRow {
  engine: string;
  label: string;
  score: number | null;
  impact: string;
  deltaLabel: string | null;
}

/**
 * Builds the per-engine scorecard rows that the PDF renderer uses.
 * Exported so tests can verify the variation indicators are present in
 * the data that drives the visual scorecard — without generating a full PDF.
 */
export function buildScorecardEngineRows(data: PdfReportData): ScorecardEngineRow[] {
  const { findings } = normalizePdfScorecard(data);
  return findings
    .filter((f) => f.score != null)
    .map((f) => {
      const previousFinding = data.previousFindings?.find((p) => p.engine === f.engine);
      return {
        engine: f.engine,
        label: f.title || f.engine,
        score: f.score ?? null,
        impact: f.impact,
        deltaLabel: scorecardDeltaLabel(f.score, previousFinding?.score),
      };
    });
}

export function normalizePdfScorecard(data: PdfReportData) {
  const thresholds = resolveScoreThresholds(data.scoreThresholds);
  const findings = (data.findings ?? []).map((finding) => ({
    ...finding,
    impact: scorePriority(finding.score, thresholds) ?? finding.impact,
  }));

  return {
    thresholds,
    findings,
    blufRecommendation: findings.length > 0
      ? buildPriorityBluf(findings)
      : data.blufRecommendation ?? null,
  };
}

function diagnosticLevelLabel(item: PdfFullDiagnosticScoreItem) {
  if (item.levelLabel) return item.levelLabel;
  if (item.level != null && DIAGNOSTIC_LEVEL_LABELS[item.level]) {
    return DIAGNOSTIC_LEVEL_LABELS[item.level];
  }
  return "Dados não informados";
}

function diagnosticLevelColor(item: PdfFullDiagnosticScoreItem) {
  switch (item.level) {
    case 0: return "#dc2626";
    case 1: return "#ea580c";
    case 2: return "#ca8a04";
    case 3: return "#16a34a";
    case 4: return "#0284c7";
    default: return "#6b7280";
  }
}

function diagnosticValue(item: PdfFullDiagnosticScoreItem, showScore: boolean) {
  if (showScore) return item.score == null ? "—" : `${Math.round(item.score)}/100`;
  if (item.value == null) return "—";
  const rounded = Math.abs(item.value) >= 100 ? Math.round(item.value) : Math.round(item.value * 10) / 10;
  if (item.unit === "%") return `${rounded}%`;
  if (item.unit === "dias") return `${Math.round(item.value)} dias`;
  if (item.unit === "pts") return `${rounded} pts`;
  if (item.unit === "x") return `${rounded}×`;
  return String(rounded);
}

const DIAGNOSTIC_INDICATOR_GROUPS = [
  { engine: "financial", label: "Financeiro" },
  { engine: "commercial", label: "Comercial" },
  { engine: "marketing", label: "Marketing" },
  { engine: "operations", label: "Operações" },
  { engine: "hr", label: "Pessoas" },
] as const;

const DIAGNOSTIC_INDICATOR_ENGINE_BY_KEY: Record<string, string> = {
  safetyMargin: "financial",
  ebitdaMargin: "financial",
  mcPct: "financial",
  cashCycle: "financial",
  markupOnCogs: "financial",
  churnRate: "commercial",
  conversionRate: "commercial",
  ltvCacRatio: "commercial",
  nps: "marketing",
  defaultRate: "marketing",
  roas: "marketing",
  oeeIndex: "operations",
  capacityUtilization: "operations",
  turnoverCostRevenuePct: "hr",
  trainingRoi: "hr",
};

export interface PdfDiagnosticIndicatorGroup {
  engine: string;
  label: string;
  items: PdfFullDiagnosticScoreItem[];
}

function diagnosticIndicatorEngine(item: PdfFullDiagnosticScoreItem) {
  return item.engine ?? (item.key ? DIAGNOSTIC_INDICATOR_ENGINE_BY_KEY[item.key] : undefined);
}

/**
 * Groups indicators in the same order as the engine scorecards. Within each
 * engine, indicators with data come first so missing inputs are easy to spot
 * without hiding them.
 */
export function groupDiagnosticIndicators(items: PdfFullDiagnosticScoreItem[]): PdfDiagnosticIndicatorGroup[] {
  const groups = new Map<string, PdfDiagnosticIndicatorGroup>(
    DIAGNOSTIC_INDICATOR_GROUPS.map(({ engine, label }) => [engine, { engine, label, items: [] }]),
  );
  const ungrouped: PdfFullDiagnosticScoreItem[] = [];

  for (const item of items) {
    const group = groups.get(diagnosticIndicatorEngine(item) ?? "");
    if (group) group.items.push(item);
    else ungrouped.push(item);
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => Number(a.value == null) - Number(b.value == null));
  }

  if (ungrouped.length > 0) {
    groups.set("other", {
      engine: "other",
      label: "Outros indicadores",
      items: ungrouped,
    });
  }

  return [...groups.values()].filter((group) => group.items.length > 0);
}

function buildDiagnosticScorecardRows(
  items: PdfFullDiagnosticScoreItem[],
  showScore: boolean,
  keyPrefix: string,
) {
  return items.map((item, index) => {
    const levelColor = diagnosticLevelColor(item);
    const muted = item.value == null && !showScore;
    const cellStyle = muted ? styles.diagnosticMutedCell : {};
    return ce(
      View,
      {
        key: `${keyPrefix}-${index}`,
        style: [
          styles.diagnosticTableRow,
          index % 2 === 1 ? styles.tableRowAlt : {},
          muted ? styles.diagnosticTableRowMuted : {},
        ],
      },
      ce(Text, { style: [styles.tableCell, styles.diagnosticColLabel, cellStyle] }, item.label),
      ce(Text, { style: [styles.tableCell, styles.diagnosticColValue, cellStyle] }, diagnosticValue(item, showScore)),
      ce(
        Text,
        { style: [styles.tableCell, styles.diagnosticColLevel, { color: muted ? "#9ca3af" : levelColor, fontFamily: "Helvetica-Bold" }] },
        diagnosticLevelLabel(item),
      ),
    );
  });
}

function buildGroupedDiagnosticIndicatorRows(items: PdfFullDiagnosticScoreItem[]) {
  const groups = groupDiagnosticIndicators(items);
  return groups.flatMap((group) => [
    ce(
      View,
      { key: `indicator-group-${group.engine}`, style: styles.diagnosticGroupHeader },
      ce(Text, { style: styles.diagnosticGroupHeaderText }, group.label),
    ),
    ...buildDiagnosticScorecardRows(group.items, false, `indicator-${group.engine}`),
  ]);
}

function diagnosticBadgeStyle(label: string) {
  const normalized = label.toLocaleLowerCase("pt-BR");
  if (["excelente", "classe mundial", "saudável", "baixo"].includes(normalized)) {
    return { backgroundColor: "#dcfce7", color: "#166534" };
  }
  if (["bom"].includes(normalized)) {
    return { backgroundColor: "#dbeafe", color: "#1d4ed8" };
  }
  if (["aceitável", "médio"].includes(normalized)) {
    return { backgroundColor: "#fef9c3", color: "#854d0e" };
  }
  return { backgroundColor: "#fee2e2", color: "#b91c1c" };
}
function buildFullDiagnosticDocument(data: PdfFullDiagnosticData) {
  const periodLine = data.period ? `  ·  Período: ${data.period}` : "";
  const indicators = data.scorecard.indicators ?? [];
  const engines = data.scorecard.engines ?? [];
  const narrativeSections = data.narrative?.sections ?? [];

  return ce(
    Document,
    null,
    ce(
      Page,
      { size: "A4", style: [styles.page, styles.fullDiagnosticPage] },
      ce(
        View,
        { style: [styles.header, styles.fullDiagnosticHeader], fixed: true },
        ce(
          View,
          { style: styles.headerLeft },
          ce(Text, { style: styles.headerTitle }, "GESAIA"),
          ce(Text, { style: styles.headerSubtitle }, "Plataforma de Inteligência Gerencial"),
        ),
        ce(
          View,
          { style: styles.headerRight },
          ce(Text, { style: styles.headerLabel }, "RELATÓRIO COMPLETO DE DIAGNÓSTICO"),
          ce(Text, { style: styles.headerContext }, data.companyName),
          ce(Text, { style: styles.headerDate }, data.generatedAt + periodLine),
        ),
      ),
      ce(
        View,
        { style: styles.body },
        ce(Text, { style: styles.companyName }, data.companyName),
        ce(
          Text,
          { style: styles.companyMeta },
          `Setor: ${data.sector ?? "Geral"}${data.period ? `  ·  Período: ${data.period}` : ""}`,
        ),
        ce(View, { style: styles.divider }),

        data.narrative?.executiveSummary
          ? ce(
              View,
              { style: styles.diagnosticSummaryBox },
              ce(Text, { style: styles.blufLabel }, "RESUMO EXECUTIVO"),
              ce(Text, { style: styles.diagnosticNarrative }, data.narrative.executiveSummary),
            )
          : null,

        data.blufRecommendation
          ? ce(
              View,
              { style: styles.blufBox },
              ce(Text, { style: styles.blufLabel }, "RECOMENDAÇÃO PRIORITÁRIA"),
              ce(Text, { style: styles.blufText }, data.blufRecommendation),
            )
          : null,

        data.financialIndicators
          ? buildFinancialIndicatorsSection(data.financialIndicators)
          : null,

        data.missingFields && data.missingFields.length > 0
          ? ce(
              View,
              { style: styles.diagnosticMissing },
              ce(Text, { style: styles.diagnosticSubheading }, "DADOS NÃO INFORMADOS"),
              ce(Text, { style: styles.diagnosticNarrative }, `${data.missingFields.join(", ")}. Os cálculos que dependem desses dados aparecem como não informados.`),
            )
          : null,

        buildDiagnosticIndicatorsSection(data.diagnosticIndicators),

        narrativeSections.length > 0
          ? ce(
              View,
              null,
              ce(Text, { style: styles.sectionTitle }, "Análise detalhada"),
              ...narrativeSections.map((section, index) =>
                ce(
                  View,
                  { key: `narrative-${index}`, style: { marginBottom: 9, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" } },
                  ce(Text, { style: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#0f3460", marginBottom: 4 } }, section.title),
                  ce(Text, { style: styles.diagnosticNarrative }, section.narrative),
                  section.causes && section.causes.length > 0
                    ? ce(
                        View,
                        null,
                        ce(Text, { style: styles.diagnosticSubheading }, "Causas prováveis"),
                        ...section.causes.map((cause, causeIndex) =>
                          ce(Text, { key: `cause-${causeIndex}`, style: styles.diagnosticBullet }, `• ${cause}`),
                        ),
                      )
                    : null,
                  section.suggestions && section.suggestions.length > 0
                    ? ce(
                        View,
                        null,
                        ce(Text, { style: styles.diagnosticSubheading }, "Sugestões de melhoria"),
                        ...section.suggestions.map((suggestion, suggestionIndex) =>
                          ce(
                            Text,
                            { key: `suggestion-${suggestionIndex}`, style: styles.diagnosticBullet },
                            `• ${suggestion.action}${suggestion.expectedImpact ? ` — Impacto esperado: ${suggestion.expectedImpact}` : ""}`,
                          ),
                        ),
                      )
                    : null,
                ),
              ),
            )
          : null,

        data.narrative?.nextSteps
          ? ce(
              View,
              { style: styles.diagnosticSummaryBox },
              ce(Text, { style: styles.blufLabel }, "PRÓXIMOS PASSOS"),
              ce(Text, { style: styles.diagnosticNarrative }, data.narrative.nextSteps),
            )
          : null,

        ce(Text, { style: styles.sectionTitle }, "Scorecard"),
        indicators.length > 0
          ? ce(
              View,
              { style: { marginBottom: 9 } },
              ce(Text, { style: styles.diagnosticSubheading }, "Indicadores-chave"),
              ce(
                View,
                { style: styles.diagnosticTableHeader },
                ce(Text, { style: [styles.tableHeaderText, styles.diagnosticColLabel] }, "Indicador"),
                ce(Text, { style: [styles.tableHeaderText, styles.diagnosticColValue] }, "Valor"),
                ce(Text, { style: [styles.tableHeaderText, styles.diagnosticColLevel] }, "Classificação"),
              ),
               ...(
                 indicators.some((item) => diagnosticIndicatorEngine(item))
                   ? buildGroupedDiagnosticIndicatorRows(indicators)
                   : buildDiagnosticScorecardRows(indicators, false, "indicator")
               ),
            )
          : null,
        engines.length > 0
          ? ce(
              View,
              null,
              ce(Text, { style: styles.diagnosticSubheading }, "Motores de análise"),
              ce(
                View,
                { style: styles.diagnosticTableHeader },
                ce(Text, { style: [styles.tableHeaderText, styles.diagnosticColLabel] }, "Motor"),
                ce(Text, { style: [styles.tableHeaderText, styles.diagnosticColValue] }, "Score"),
                ce(Text, { style: [styles.tableHeaderText, styles.diagnosticColLevel] }, "Classificação"),
              ),
              ...buildDiagnosticScorecardRows(engines, true, "engine"),
            )
          : null,
      ),
      ce(
        Text,
        {
          style: styles.footer,
          render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `GESAIA — Plataforma de Inteligência Gerencial  ·  Página ${pageNumber} de ${totalPages}`,
          fixed: true,
        },
      ),
    ),
  );
}

function ce<T>(type: T, props?: any, ...children: any[]): any {
  return React.createElement(type as any, props, ...children);
}

function buildDocument(data: PdfReportData) {
  const periodLine = data.period ? `  ·  Período: ${data.period}` : "";
  const { thresholds, findings, blufRecommendation } = normalizePdfScorecard(data);

  return ce(
    Document,
    null,
    ce(
      Page,
      { size: "A4", style: styles.page },

      // ── Header ──────────────────────────────────────────────────────────
      ce(
        View,
        { style: styles.header },
        ce(
          View,
          { style: styles.headerLeft },
          ce(Text, { style: styles.headerTitle }, "GESAIA"),
          ce(Text, { style: styles.headerSubtitle }, "Plataforma de Inteligência Gerencial"),
        ),
        ce(
          View,
          { style: styles.headerRight },
          ce(Text, { style: styles.headerLabel }, "RELATÓRIO GERENCIAL"),
          ce(Text, { style: styles.headerDate }, data.generatedAt + periodLine),
        ),
      ),

      // ── Body ────────────────────────────────────────────────────────────
      ce(
        View,
        { style: styles.body },

        // Company info
        ce(Text, { style: styles.companyName }, data.companyName),
        ce(
          Text,
          { style: styles.companyMeta },
          `${data.segment}  ·  ${data.activity}  ·  ${data.businessModel}`,
        ),
        ce(View, { style: styles.divider }),

        // BLUF
        blufRecommendation
          ? ce(
              View,
              { style: styles.blufBox },
              ce(Text, { style: styles.blufLabel }, "RECOMENDAÇÃO PRINCIPAL"),
              ce(Text, { style: styles.blufText }, blufRecommendation),
            )
          : null,

        // ── Financial Indicators (MC, PE, Margem de Segurança, Ciclo de Caixa) ──
        data.financialIndicators
          ? buildFinancialIndicatorsSection(data.financialIndicators)
          : null,

        // ── Visual Scorecard (grouped by priority tier) ─────────────────
        findings.some(f => f.score != null)
          ? ce(
              View,
              { style: styles.scorecardSection },
              ce(Text, { style: styles.sectionTitle }, "Scorecard dos Motores"),
               ce(
                 Text,
                 { style: { fontSize: 7, color: "#6b7280", marginBottom: 5 } },
                 `Verde: ≥ ${thresholds.greenMin}  ·  Amarelo: ≥ ${thresholds.yellowMin}  ·  Vermelho: < ${thresholds.yellowMin}`,
               ),
              ...(["high", "medium", "low"] as const).map(tier => {
                 const group = findings.filter(f => f.impact === tier);
                if (group.length === 0) return null;
                const tierLabel = tier === "high" ? "Alta Prioridade" : tier === "medium" ? "Média Prioridade" : "Boa Performance";
                const tierColor = tier === "high" ? "#dc2626" : tier === "medium" ? "#ca8a04" : "#16a34a";
                const tierBg   = tier === "high" ? "#fef2f2"  : tier === "medium" ? "#fefce8"  : "#f0fdf4";
                return ce(
                  View,
                  { key: tier, style: { marginBottom: 8 } },
                  // Tier header pill
                  ce(
                    View,
                    { style: { flexDirection: "row", alignItems: "center", marginBottom: 4 } },
                    ce(View, { style: { width: 8, height: 8, borderRadius: 4, backgroundColor: tierColor, marginRight: 5 } }),
                    ce(Text, { style: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: tierColor } }, tierLabel),
                  ),
                  // Engine bars
                  ...group.map((f, idx) => {
                    const sc = f.score;
                    const barColor = scoreColor(sc, thresholds);
                    const barWidth = sc != null ? `${Math.round(sc)}%` : "0%";
                    const label = f.title || f.engine;
                    const previousFinding = data.previousFindings?.find((previous) => previous.engine === f.engine);
                    const deltaLabel = scorecardDeltaLabel(sc, previousFinding?.score);
                    const delta = deltaLabel == null ? null : Math.round(sc! - (previousFinding!.score!));
                    const deltaColor = delta == null
                      ? "#6b7280"
                      : delta > 0
                        ? "#16a34a"
                        : delta < 0
                          ? "#dc2626"
                          : "#6b7280";
                    return ce(
                      View,
                      { key: idx, style: { flexDirection: "row", alignItems: "center", marginBottom: 3, backgroundColor: tierBg, borderRadius: 3, paddingVertical: 4, paddingHorizontal: 6 } },
                      // Engine label
                      ce(Text, { style: { fontSize: 7, color: "#374151", width: 90 } }, label),
                      // Bar track
                      ce(
                        View,
                        { style: { flex: 1, height: 6, backgroundColor: "#e5e7eb", borderRadius: 3, marginHorizontal: 6 } },
                        ce(View, { style: { width: barWidth, height: 6, backgroundColor: barColor, borderRadius: 3 } }),
                      ),
                      // Score label
                      ce(Text, { style: { fontSize: 8, fontFamily: "Helvetica-Bold", color: barColor, width: 24, textAlign: "right" } },
                        sc != null ? String(sc) : "—"),
                      // Change since the previous period, when both scores exist
                      deltaLabel
                        ? ce(Text, { style: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: deltaColor, width: 40, textAlign: "right", marginLeft: 4 } }, deltaLabel)
                        : null,
                    );
                  }),
                );
              }),
            )
          : null,

        // KPIs
        data.kpis && data.kpis.length > 0
          ? ce(
              View,
              null,
              ce(Text, { style: styles.sectionTitle }, "Indicadores-Chave (KPIs)"),
              ce(
                View,
                { style: styles.tableHeader },
                ce(Text, { style: [styles.tableHeaderText, styles.kpiColLabel] }, "Indicador"),
                ce(Text, { style: [styles.tableHeaderText, styles.kpiColValue] }, "Valor"),
                ce(Text, { style: [styles.tableHeaderText, styles.kpiColStatus] }, "Status"),
              ),
              ...data.kpis.map((kpi, i) =>
                ce(
                  View,
                  { key: i, style: [styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}] },
                  ce(Text, { style: [styles.tableCell, styles.kpiColLabel] }, kpi.label),
                  ce(Text, { style: [styles.tableCell, styles.kpiColValue] }, kpi.value),
                  ce(
                    Text,
                    { style: [styles.tableCell, styles.kpiColStatus, statusStyle(kpi.status)] },
                    STATUS_LABELS[kpi.status] ?? kpi.status,
                  ),
                ),
              ),
            )
          : null,

        // Alerts
        data.alerts && data.alerts.length > 0
          ? ce(
              View,
              null,
              ce(Text, { style: styles.sectionTitle }, "Alertas"),
              ce(
                View,
                {
                  style: [
                    styles.tableHeader,
                    { backgroundColor: "#dc2626" } as any,
                  ],
                },
                ce(Text, { style: [styles.tableHeaderText, styles.alertColMsg] }, "Alerta"),
                ce(Text, { style: [styles.tableHeaderText, styles.alertColEngine] }, "Motor"),
                ce(Text, { style: [styles.tableHeaderText, styles.alertColSev] }, "Severidade"),
              ),
              ...data.alerts.map((a, i) =>
                ce(
                  View,
                  { key: i, style: [styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}] },
                  ce(Text, { style: [styles.tableCell, styles.alertColMsg] }, a.message),
                  ce(Text, { style: [styles.tableCell, styles.alertColEngine] }, a.engine),
                  ce(
                    Text,
                    {
                      style: [
                        styles.tableCell,
                        styles.alertColSev,
                        a.severity === "high"
                          ? styles.statusCritical
                          : a.severity === "medium"
                            ? styles.statusWarning
                            : {},
                      ],
                    },
                    severityLabel(a.severity),
                  ),
                ),
              ),
            )
          : null,

        // Findings
        findings.length > 0
          ? ce(
              View,
              null,
              ce(Text, { style: styles.sectionTitle }, "Análise por Motor"),
              ce(
                View,
                { style: styles.tableHeader },
                ce(Text, { style: [styles.tableHeaderText, styles.findColScore] }, "Score"),
                ce(Text, { style: [styles.tableHeaderText, styles.findColTitle] }, "Motor"),
                ce(Text, { style: [styles.tableHeaderText, styles.findColPriority] }, "Prioridade"),
                ce(Text, { style: [styles.tableHeaderText, styles.findColSummary] }, "Resumo"),
              ),
               ...[...findings]
                .sort((a, b) => {
                  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
                  return (order[a.impact] ?? 1) - (order[b.impact] ?? 1);
                })
                .map((f, i) => {
                  const findingScoreColor = f.score == null
                    ? "#666666"
                    : scoreColor(f.score, thresholds);
                  return ce(
                    View,
                    { key: i, style: [styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}] },
                    ce(Text, { style: [styles.tableCell, styles.findColScore, { color: findingScoreColor, fontFamily: "Helvetica-Bold" } as any] },
                      f.score != null ? String(f.score) : "—"),
                    ce(Text, { style: [styles.tableCell, styles.findColTitle] }, f.title),
                    ce(
                      Text,
                      { style: [styles.tableCell, styles.findColPriority] },
                      IMPACT_LABELS[f.impact] ?? f.impact,
                    ),
                    ce(Text, { style: [styles.tableCell, styles.findColSummary] }, f.summary),
                  );
                }),
            )
          : ce(
              View,
              null,
              ce(Text, { style: styles.sectionTitle }, "Análise por Motor"),
              ce(
                View,
                { style: styles.noAnalysisBox },
                ce(Text, { style: styles.noAnalysisText },
                  "Nenhuma análise de IA foi executada para este período. Acesse a aba \"Análise\" e clique em \"Analisar\" para gerar os insights dos 9 motores e incluí-los no próximo relatório."
                ),
              ),
            ),
      ),

      // ── Footer ──────────────────────────────────────────────────────────
      ce(
        Text,
        {
          style: styles.footer,
          render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `GESAIA — Plataforma de Inteligência Gerencial  ·  Página ${pageNumber} de ${totalPages}`,
          fixed: true,
        },
      ),
    ),
  );
}

export async function generatePdfReport(data: PdfReportData): Promise<Buffer> {
  const doc = buildDocument(data);
  return renderToBuffer(doc);
}

export async function generateFullDiagnosticPdf(data: PdfFullDiagnosticData): Promise<Buffer> {
  const doc = buildFullDiagnosticDocument(data);
  return renderToBuffer(doc);
}

function buildDiagnosticIndicatorsSection(indicators: PdfDiagnosticIndicators | null | undefined) {
  if (!indicators) return null;
  const sections: any[] = [];
  const commercial = indicators.commercial;
  const marketing = indicators.marketing;
  const operations = indicators.operations;
  const hr = indicators.hr;
  const risks = indicators.risks;

  if (commercial && (commercial.cac != null || commercial.ltv != null || commercial.ltvCacRatio != null)) {
    const cards = [
      commercial.cac != null
        ? diagnosticMetricCard("commercial-cac", "CAC", formatBrl(commercial.cac), undefined, "#047857")
        : null,
      commercial.ltv != null
        ? diagnosticMetricCard("commercial-ltv", "LTV", formatBrl(commercial.ltv), undefined, "#1d4ed8")
        : null,
      commercial.ltvCacRatio != null
        ? diagnosticMetricCard(
            "commercial-ltv-cac",
            "LTV/CAC",
            `${commercial.ltvCacRatio.toFixed(1)}×`,
            commercial.ltvCacClassification,
          )
        : null,
    ].filter(Boolean);
    sections.push(
      ce(
        View,
        { key: "commercial-section", style: styles.diagnosticIndicatorsSection },
        ce(Text, { style: styles.diagnosticIndicatorTitle }, "Comercial"),
        ce(View, { style: styles.diagnosticIndicatorGrid }, ...cards),
      ),
    );
  }

  if (marketing && (marketing.ctr != null || marketing.cpl != null || marketing.roas != null || marketing.roiMarketing != null)) {
    const cards = [
      marketing.ctr != null
        ? diagnosticMetricCard("marketing-ctr", "CTR", `${marketing.ctr.toFixed(2)}%`, marketing.ctrClassification, "#6d28d9")
        : null,
      marketing.cpl != null
        ? diagnosticMetricCard("marketing-cpl", "CPL", formatBrl(marketing.cpl), undefined, "#1d4ed8")
        : null,
      marketing.roas != null
        ? diagnosticMetricCard("marketing-roas", "ROAS", `${marketing.roas.toFixed(1)}×`, marketing.roasClassification, "#047857")
        : null,
      marketing.roiMarketing != null
        ? diagnosticMetricCard("marketing-roi", "ROI de Marketing", `${marketing.roiMarketing.toFixed(1)}%`, marketing.roiClassification, "#b45309")
        : null,
    ].filter(Boolean);
    sections.push(
      ce(
        View,
        { key: "marketing-section", style: styles.diagnosticIndicatorsSection },
        ce(Text, { style: styles.diagnosticIndicatorTitle }, "Marketing"),
        ce(View, { style: styles.diagnosticIndicatorGrid }, ...cards),
      ),
    );
  }

  if (operations && (operations.oeeIndex != null || operations.capacitySlack != null || operations.bottleneckStage)) {
    const cards = [
      operations.oeeIndex != null
        ? diagnosticMetricCard("operations-oee", "OEE", `${operations.oeeIndex.toFixed(1)}%`, operations.oeeClassification, "#c2410c")
        : null,
      operations.capacitySlack != null
        ? diagnosticMetricCard("operations-slack", "Folga de Capacidade", `${operations.capacitySlack.toFixed(1)}%`, undefined, "#b45309")
        : null,
      operations.bottleneckStage
        ? diagnosticMetricCard("operations-bottleneck", "Gargalo Detectado", operations.bottleneckStage, undefined, "#b91c1c")
        : null,
    ].filter(Boolean);
    sections.push(
      ce(
        View,
        { key: "operations-section", style: styles.diagnosticIndicatorsSection },
        ce(Text, { style: styles.diagnosticIndicatorTitle }, "Operações"),
        ce(View, { style: styles.diagnosticIndicatorGrid }, ...cards),
      ),
    );
  }

  if (hr && (hr.turnoverCostTotal != null || hr.trainingRoi != null || hr.trainingPaybackMonths != null)) {
    const cards = [
      hr.turnoverCostTotal != null
        ? diagnosticMetricCard("hr-turnover", "Custo Total de Turnover", formatBrl(hr.turnoverCostTotal), undefined, "#be123c")
        : null,
      hr.trainingRoi != null
        ? diagnosticMetricCard("hr-training-roi", "ROI de Treinamento", `${hr.trainingRoi.toFixed(1)}×`, hr.trainingRoiClassification, "#be185d")
        : null,
      hr.trainingPaybackMonths != null
        ? diagnosticMetricCard("hr-training-payback", "Payback de Treinamento", `${Math.round(hr.trainingPaybackMonths)} meses`)
        : null,
    ].filter(Boolean);
    sections.push(
      ce(
        View,
        { key: "hr-section", style: styles.diagnosticIndicatorsSection },
        ce(Text, { style: styles.diagnosticIndicatorTitle }, "Pessoas (RH)"),
        ce(View, { style: styles.diagnosticIndicatorGrid }, ...cards),
      ),
    );
  }

  if (risks && ((risks.riskMatrix?.length ?? 0) > 0 || risks.totalExpectedLoss != null || risks.overallExposure)) {
    const cards = [
      risks.totalExpectedLoss != null
        ? diagnosticMetricCard("risks-expected-loss", "Perda Esperada Total", formatBrl(risks.totalExpectedLoss), undefined, "#b91c1c")
        : null,
      risks.overallExposure
        ? diagnosticMetricCard("risks-overall-exposure", "Exposição Geral", risks.overallExposure, risks.overallExposure, "#b91c1c")
        : null,
    ].filter(Boolean);
    const matrix = risks.riskMatrix ?? [];
    sections.push(
      ce(
        View,
        { key: "risks-section", style: styles.diagnosticIndicatorsSection },
        ce(Text, { style: styles.diagnosticIndicatorTitle }, "Riscos"),
        cards.length > 0 ? ce(View, { style: styles.diagnosticIndicatorGrid }, ...cards) : null,
        matrix.length > 0
          ? ce(
              View,
              { style: { marginBottom: 7 } },
              ce(Text, { style: styles.diagnosticSubheading }, "Matriz de Riscos (probabilidade × impacto)"),
              ce(
                View,
                { style: styles.diagnosticTableHeader, wrap: false, fixed: true },
                ce(Text, { style: [styles.tableHeaderText, styles.riskColName] }, "Risco"),
                ce(Text, { style: [styles.tableHeaderText, styles.riskColProbability] }, "Probabilidade"),
                ce(Text, { style: [styles.tableHeaderText, styles.riskColImpact] }, "Impacto"),
                ce(Text, { style: [styles.tableHeaderText, styles.riskColLoss] }, "Perda esperada"),
                ce(Text, { style: [styles.tableHeaderText, styles.riskColExposure] }, "Exposição"),
              ),
              ...matrix.map((risk, index) =>
                ce(
                  View,
                  {
                    key: `risk-${index}`,
                    style: [styles.diagnosticTableRow, index % 2 === 1 ? styles.tableRowAlt : {}],
                    wrap: false,
                  },
                  ce(Text, { style: [styles.tableCell, styles.riskColName] }, risk.name),
                  ce(Text, { style: [styles.tableCell, styles.riskColProbability] }, `${risk.probability.toFixed(1)}%${risk.probabilityLabel ? ` · ${risk.probabilityLabel}` : ""}`),
                  ce(Text, { style: [styles.tableCell, styles.riskColImpact] }, `${formatBrl(risk.impact)}${risk.impactLabel ? ` · ${risk.impactLabel}` : ""}`),
                  ce(Text, { style: [styles.tableCell, styles.riskColLoss] }, formatBrl(risk.expectedLoss)),
                  ce(Text, { style: [styles.tableCell, styles.riskColExposure, { fontFamily: "Helvetica-Bold" }] }, risk.matrixZone ?? "—"),
                ),
              ),
            )
          : null,
      ),
    );
  }

  if (sections.length === 0) return null;
  return ce(
    View,
    { style: { marginTop: 3, marginBottom: 7 } },
    ce(Text, { style: styles.sectionTitle }, "Indicadores detalhados por área"),
    ...sections,
  );
}

export interface PdfDiagnosticIndicators {
  commercial?: PdfDiagnosticCommercialIndicators | null;
  marketing?: PdfDiagnosticMarketingIndicators | null;
  operations?: PdfDiagnosticOperationsIndicators | null;
  hr?: PdfDiagnosticHrIndicators | null;
  risks?: PdfDiagnosticRiskIndicators | null;
}

export interface PdfDiagnosticHrIndicators {
  turnoverCostTotal?: number | null;
  trainingRoi?: number | null;
  trainingRoiClassification?: string | null;
  trainingPaybackMonths?: number | null;
}

export interface PdfDiagnosticRiskIndicators {
  riskMatrix?: PdfDiagnosticRiskMatrixItem[];
  totalExpectedLoss?: number | null;
  overallExposure?: string | null;
}

function resultString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatBrl(value: number) {
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

function resultNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Keep the PDF payload aligned with the calculation engine output. The engine
 * results are intentionally normalized here so old saved reports and newly
 * generated reports can share the same renderer.
 */
export function buildPdfDiagnosticIndicators(
  engineResults: Record<string, unknown>,
): PdfDiagnosticIndicators {
  const commercial = resultRecord(engineResults.commercial);
  const marketing = resultRecord(engineResults.marketing);
  const operations = resultRecord(engineResults.operations);
  const hr = resultRecord(engineResults.hr);
  const risks = resultRecord(engineResults.risks);

  const riskMatrix = Array.isArray(risks.riskMatrix)
    ? risks.riskMatrix.flatMap((risk): PdfDiagnosticRiskMatrixItem[] => {
        const item = resultRecord(risk);
        const probability = resultNumber(item.probability);
        const impact = resultNumber(item.impact);
        const expectedLoss = resultNumber(item.expectedLoss);
        if (probability === null || impact === null || expectedLoss === null) return [];
        return [{
          name: resultString(item.name) ?? "Risco",
          probability,
          probabilityLabel: resultString(item.probabilityLabel),
          impact,
          impactLabel: resultString(item.impactLabel),
          expectedLoss,
          matrixZone: resultString(item.matrixZone),
        }];
      })
    : [];

  return {
    commercial: {
      cac: resultNumber(commercial.cac),
      ltv: resultNumber(commercial.estimatedLTV ?? commercial.ltv),
      ltvCacRatio: resultNumber(commercial.ltvCacRatio),
      ltvCacClassification: resultString(commercial.ltvCacClassification),
    },
    marketing: {
      ctr: resultNumber(marketing.ctr),
      ctrClassification: resultString(marketing.ctrClassification),
      cpl: resultNumber(marketing.cpl),
      roas: resultNumber(marketing.roas),
      roasClassification: resultString(marketing.roasClassification),
      roiMarketing: resultNumber(marketing.roiMarketing),
      roiClassification: resultString(marketing.roiClassification),
    },
    operations: {
      oeeIndex: resultNumber(operations.oeeIndex),
      oeeClassification: resultString(operations.oeeClassification),
      capacitySlack: resultNumber(operations.capacitySlack),
      bottleneckStage: resultString(operations.bottleneckStage),
    },
    hr: {
      turnoverCostTotal: resultNumber(hr.turnoverCostTotal),
      trainingRoi: resultNumber(hr.trainingRoi ?? hr.trainingRoiEstimate),
      trainingRoiClassification: resultString(hr.trainingRoiClassification),
      trainingPaybackMonths: resultNumber(hr.trainingPaybackMonths),
    },
    risks: {
      riskMatrix,
      totalExpectedLoss: resultNumber(risks.totalExpectedLoss),
      overallExposure: resultString(risks.overallExposure),
    },
  };
}

export interface PdfDiagnosticRiskMatrixItem {
  name: string;
  probability: number;
  probabilityLabel?: string | null;
  impact: number;
  impactLabel?: string | null;
  expectedLoss: number;
  matrixZone?: string | null;
}

export interface PdfDiagnosticOperationsIndicators {
  oeeIndex?: number | null;
  oeeClassification?: string | null;
  capacitySlack?: number | null;
  bottleneckStage?: string | null;
}

export interface PdfDiagnosticMarketingIndicators {
  ctr?: number | null;
  ctrClassification?: string | null;
  cpl?: number | null;
  roas?: number | null;
  roasClassification?: string | null;
  roiMarketing?: number | null;
  roiClassification?: string | null;
}

function diagnosticMetricCard(
  key: string,
  label: string,
  value: string,
  badge?: string | null,
  color = "#1e3a5f",
) {
  const badgeStyle = badge ? diagnosticBadgeStyle(badge) : null;
  return ce(
    View,
    { key, style: styles.diagnosticIndicatorCard },
    ce(Text, { style: styles.diagnosticIndicatorLabel }, label),
    ce(Text, { style: [styles.diagnosticIndicatorValue, { color }] }, value),
    badge && badgeStyle
      ? ce(
          View,
          { style: [styles.diagnosticIndicatorBadge, { backgroundColor: badgeStyle.backgroundColor }] },
          ce(Text, { style: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: badgeStyle.color } }, badge),
        )
      : null,
  );
}
