import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import jsPDF from "jspdf";
import { useQuery } from "@tanstack/react-query";
import {
  comparePeriodsTrend,
  getListPeriodsQueryKey,
  listPeriods,
  type PeriodTrend,
} from "@workspace/api-client-react";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, ArrowRight,
  GitCompare, Loader2, Info, Brain, Printer, Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipTrigger as UiTooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveStaleComparisonPeriod } from "./stalePeriod";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, Legend, ComposedChart, Area, Line, Scatter,
} from "recharts";
import {
  STALE_TREND_RANGE_ERROR,
  isTrendRangeNotFound,
  validateTrendPeriodCoverage,
} from "./trendRange";

interface BridgePanelProps { companyId: number; companyName?: string }

// Render markdown-like text (same pattern as QuickDiagnosisPanel)
function EvolutionText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed text-foreground">
      {lines.map((line, i) => {
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          return <p key={i} className="font-semibold text-foreground mt-4 first:mt-0">{line.trim().replace(/\*\*/g, "")}</p>;
        }
        if (line.includes("**")) {
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={i} className={line.trim() === "" ? "mt-2" : ""}>
              {parts.map((part, j) => /^\*\*[^*]+\*\*$/.test(part)
                ? <strong key={j}>{part.replace(/\*\*/g, "")}</strong> : part)}
            </p>
          );
        }
        if (line.trim().startsWith("- ")) return <p key={i} className="pl-4"><span className="text-muted-foreground mr-1">•</span>{line.trim().slice(2)}</p>;
        if (/^\d+\.\s/.test(line.trim())) return <p key={i} className="pl-4">{line.trim()}</p>;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */
function brl(v: number) {
  return `R$ ${Math.abs(Math.round(v)).toLocaleString("pt-BR")}`;
}
function pctStr(v: number | null) {
  if (v === null) return null;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function DeltaBadge({ delta, deltaPct, unit = "BRL", invert = false }: {
  delta: number; deltaPct?: number | null; unit?: "BRL" | "pct" | "count"; invert?: boolean;
}) {
  const good = invert ? delta < 0 : delta > 0;
  const neutral = Math.abs(delta) < 1;
  const color = neutral ? "text-muted-foreground" : good ? "text-emerald-600" : "text-red-500";
  const Arrow = neutral ? null : good ? TrendingUp : TrendingDown;
  const formatted = unit === "BRL" ? brl(delta)
    : unit === "pct" ? `${Math.abs(delta).toFixed(1)}pp`
    : String(Math.abs(Math.round(delta)));
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-sm ${color}`}>
      {Arrow && <Arrow className="w-3.5 h-3.5 flex-shrink-0" />}
      {sign}{formatted}
      {deltaPct !== null && deltaPct !== undefined && (
        <span className="text-xs font-normal opacity-70">({pctStr(deltaPct)})</span>
      )}
    </span>
  );
}

/* ── Row in the summary table ────────────────────────────────────────── */
function SummaryRow({ label, base, comp, delta, deltaPct, unit = "BRL", invert = false }: {
  label: string; base: number; comp: number; delta: number; deltaPct?: number | null;
  unit?: "BRL" | "pct" | "count"; invert?: boolean;
}) {
  const fmt = (v: number) =>
    unit === "BRL"   ? `R$ ${Math.round(v).toLocaleString("pt-BR")}` :
    unit === "pct"   ? `${v.toFixed(1)}%` :
    Math.round(v).toString();

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2.5 pr-4 text-sm text-muted-foreground w-44">{label}</td>
      <td className="py-2.5 pr-4 text-sm font-medium text-foreground text-right">{fmt(base)}</td>
      <td className="py-2.5 pr-4 text-sm font-medium text-foreground text-right">{fmt(comp)}</td>
      <td className="py-2.5 text-right">
        <DeltaBadge delta={delta} deltaPct={deltaPct} unit={unit} invert={invert} />
      </td>
    </tr>
  );
}

/* ── Waterfall bar chart ─────────────────────────────────────────────── */
function WaterfallChart({ bridge, deltaResult }: {
  bridge: { label: string; value: number; description: string }[];
  deltaResult: number;
}) {
  // Build waterfall data: running total bars + final bar
  let running = 0;
  const bars = bridge.map(b => {
    const start = running;
    running += b.value;
    return { name: b.label, start, value: b.value, end: running };
  });

  // Add final "Δ Resultado" bar for comparison
  const chartData = [
    ...bars.map(b => ({
      name: b.name,
      invisible: b.value >= 0 ? b.start : b.start + b.value,
      value: Math.abs(b.value),
      rawValue: b.value,
      isPositive: b.value >= 0,
      isFinal: false as boolean,
    })),
    {
      name: "Δ Resultado",
      invisible: deltaResult >= 0 ? 0 : deltaResult,
      value: Math.abs(deltaResult),
      rawValue: deltaResult,
      isPositive: deltaResult >= 0,
      isFinal: true,
    },
  ];

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    const bridgeItem = bridge.find(b => b.label === d.name);
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs max-w-xs">
        <p className="font-semibold text-foreground mb-1">{d.name}</p>
        <p className={`font-bold text-sm ${d.isPositive ? "text-emerald-600" : "text-red-500"}`}>
          {d.rawValue >= 0 ? "+" : "−"}{brl(d.rawValue)}
        </p>
        {bridgeItem && <p className="text-muted-foreground mt-1 leading-snug">{bridgeItem.description}</p>}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={v => v === 0 ? "0" : `${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
        <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={2} />
        <Tooltip content={<CustomTooltip />} />
        {/* Invisible base for waterfall effect */}
        <Bar dataKey="invisible" stackId="a" fill="transparent" radius={0} />
        {/* Visible value bar */}
        <Bar dataKey="value" stackId="a" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.isFinal
                ? (entry.isPositive ? "hsl(var(--chart-1))" : "hsl(var(--chart-5))")
                : (entry.isPositive ? "#10b981" : "#ef4444")}
              opacity={entry.isFinal ? 0.85 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

type TrendMetricKey =
  | "netRevenue"
  | "contributionMargin"
  | "contributionMarginPct"
  | "fixedCosts"
  | "operatingResult"
  | "ebitda"
  | "netProfit"
  | "activeCustomers"
  | "averageTicket"
  | "safetyMargin"
  | "cashCycle";

type TrendMetricSnapshot = {
  value: number | null;
  delta: number | null;
  deltaPct: number | null;
  unavailableReason?: "missing_inputs" | "not_applicable" | null;
  missingInputs?: string[];
};

const TREND_METRIC_LABELS: Array<{ key: TrendMetricKey; label: string; unit: "BRL" | "pct" | "count" | "days"; invertDelta?: boolean }> = [
  { key: "netRevenue", label: "Receita Líquida", unit: "BRL" },
  { key: "contributionMargin", label: "Margem de Contribuição", unit: "BRL" },
  { key: "contributionMarginPct", label: "MC %", unit: "pct" },
  { key: "fixedCosts", label: "Custos Fixos", unit: "BRL", invertDelta: true },
  { key: "operatingResult", label: "Resultado Operacional", unit: "BRL" },
  { key: "ebitda", label: "EBITDA", unit: "BRL" },
  { key: "netProfit", label: "Lucro Líquido", unit: "BRL" },
  { key: "activeCustomers", label: "Clientes Ativos", unit: "count" },
  { key: "averageTicket", label: "Ticket Médio", unit: "BRL" },
  { key: "safetyMargin", label: "Margem de Segurança", unit: "pct" },
  { key: "cashCycle", label: "Ciclo de Caixa", unit: "days", invertDelta: true },
];

export function formatTrendValue(value: number | null, unit: "BRL" | "pct" | "count" | "days") {
  if (value === null || value === undefined) return "—";
  if (unit === "pct") return `${value.toFixed(1)}%`;
  if (unit === "count") return Math.round(value).toLocaleString("pt-BR");
  if (unit === "days") return `${Math.round(value)} dias`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

export function classifyMargemSeguranca(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct < 0)   return "Péssimo";
  if (pct < 10)  return "Ruim";
  if (pct < 20)  return "Aceitável";
  if (pct < 35)  return "Bom";
  return "Excelente";
}

export function getSafetyMarginUnavailableMessage(
  metric: Pick<TrendMetricSnapshot, "value" | "unavailableReason" | "missingInputs"> | undefined,
): string | null {
  if (metric?.value !== null && metric?.value !== undefined) return null;
  if (metric?.unavailableReason === "missing_inputs") {
    if (metric.missingInputs?.includes("variableCosts")) {
      return "Não calculada: informe Custos Variáveis para este período.";
    }
    return "Não calculada: complete os dados necessários para este período.";
  }
  if (metric?.unavailableReason === "not_applicable") {
    return "Não aplicável neste período.";
  }
  return null;
}

const SAFETY_MARGIN_CLASS_STYLE: Record<string, { bg: string; text: string }> = {
  "Péssimo":   { bg: "bg-red-100 dark:bg-red-950/40",       text: "text-red-700 dark:text-red-400" },
  "Ruim":      { bg: "bg-orange-100 dark:bg-orange-950/40", text: "text-orange-700 dark:text-orange-400" },
  "Aceitável": { bg: "bg-yellow-100 dark:bg-yellow-950/40", text: "text-yellow-700 dark:text-yellow-400" },
  "Bom":       { bg: "bg-blue-100 dark:bg-blue-950/40",     text: "text-blue-700 dark:text-blue-400" },
  "Excelente": { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400" },
};

const SAFETY_MARGIN_PDF_STYLE: Record<string, { fill: [number, number, number]; text: [number, number, number] }> = {
  "Péssimo":   { fill: [254, 226, 226], text: [185, 28, 28] },
  "Ruim":      { fill: [255, 237, 213], text: [194, 65, 12] },
  "Aceitável": { fill: [254, 249, 195], text: [161, 98, 7] },
  "Bom":       { fill: [219, 234, 254], text: [29, 78, 216] },
  "Excelente": { fill: [220, 252, 231], text: [21, 128, 61] },
};

const TREND_METRICS_PDF_SECTION_HEIGHT = 50;
const TREND_METRICS_PDF_MIN_PERIOD_WIDTH = 32;

export function ensureTrendMetricsPdfPage(doc: jsPDF, startY: number) {
  if (startY + TREND_METRICS_PDF_SECTION_HEIGHT <= 280) return startY;
  doc.addPage();
  return 20;
}

type TrendPdfMetric = Pick<TrendMetricSnapshot, "value">;
export type TrendPdfSnapshot = {
  period: string;
  metrics: Record<string, TrendPdfMetric | undefined>;
};

export function getTrendPdfCell(
  key: "safetyMargin" | "cashCycle",
  metric: TrendPdfMetric | undefined,
) {
  const value = metric?.value ?? null;
  return {
    value: formatTrendValue(value, key === "cashCycle" ? "days" : "pct"),
    safetyClass: key === "safetyMargin" ? classifyMargemSeguranca(value) : null,
  };
}

/**
 * Draws the financial-trend rows of the Evolução browser PDF.
 *
 * Keeping this rendering primitive separate from the click handler lets the
 * regression test inspect a real jsPDF document without mounting the panel.
 */
export function drawTrendMetricsPdf(
  doc: jsPDF,
  periods: TrendPdfSnapshot[],
  {
    startY,
    marginL = 20,
    marginR = 20,
    pageW = 210,
    labelW = 48,
  }: {
    startY: number;
    marginL?: number;
    marginR?: number;
    pageW?: number;
    labelW?: number;
  },
) {
  const contentW = pageW - marginL - marginR;
  const pdfRows = [
    { key: "safetyMargin" as const, label: "Margem de Segurança" },
    { key: "cashCycle" as const, label: "Ciclo de Caixa" },
  ];
  const availablePeriodW = contentW - labelW;
  const periodsPerPage = Math.max(1, Math.floor(availablePeriodW / TREND_METRICS_PDF_MIN_PERIOD_WIDTH));
  let tableTop = startY;
  let endY = startY;

  // A narrow period column makes both the date and its health badge collide
  // with adjacent columns. Keep a usable minimum width and continue the table
  // on another page instead of shrinking the selected range into unreadable
  // text.
  for (let pageIndex = 0; pageIndex < periods.length; pageIndex += periodsPerPage) {
    const pagePeriods = periods.slice(pageIndex, pageIndex + periodsPerPage);
    if (pageIndex > 0) {
      doc.addPage();
      tableTop = 20;
    }

    const periodW = availablePeriodW / pagePeriods.length;
    const tableRight = pageW - marginR;
    doc.setFillColor(245, 247, 250);
    doc.rect(marginL, tableTop - 4, contentW, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(80, 80, 80);
    doc.text("Indicador", marginL + 2, tableTop + 1);
    pagePeriods.forEach((snapshot, index) => {
      doc.text(snapshot.period, marginL + labelW + periodW * index + periodW / 2, tableTop + 1, { align: "center" });
    });
    let y = tableTop + 8;

    doc.setDrawColor(220, 224, 230);
    for (const row of pdfRows) {
      const rowTop = y - 4;
      doc.line(marginL, rowTop, tableRight, rowTop);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(80, 80, 80);
      doc.text(row.label, marginL + 2, y + 3);

      pagePeriods.forEach((snapshot, index) => {
        const cell = getTrendPdfCell(row.key, snapshot.metrics[row.key]);
        const cellCenter = marginL + labelW + periodW * index + periodW / 2;
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(35, 35, 35);
        doc.text(cell.value, cellCenter, y + 1, { align: "center" });

        if (cell.safetyClass) {
          const style = SAFETY_MARGIN_PDF_STYLE[cell.safetyClass];
          const badgeW = Math.min(periodW - 3, Math.max(12, doc.getTextWidth(cell.safetyClass) + 4));
          const badgeX = cellCenter - badgeW / 2;
          doc.setFillColor(...style.fill);
          doc.roundedRect(badgeX, y + 3, badgeW, 4.5, 1, 1, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.setTextColor(...style.text);
          doc.text(cell.safetyClass, cellCenter, y + 6.1, { align: "center" });
        }
      });
      y += 14;
    }

    doc.line(marginL, y - 4, tableRight, y - 4);
    doc.setDrawColor(235, 238, 242);
    doc.line(marginL + labelW, tableTop - 4, marginL + labelW, y - 4);
    pagePeriods.forEach((_, index) => {
      const x = marginL + labelW + periodW * (index + 1);
      doc.line(x, tableTop - 4, x, y - 4);
    });
    endY = y;
  }

  return { endY, tableTop: startY };
}

type TrendChartPeriod = { period: string; metrics: Record<string, TrendMetricSnapshot> };

type TrendChartDataPoint = {
  period: string;
  netRevenue: number | null;
  contributionMargin: number | null;
  operatingResult: number | null;
  safetyMargin: number | null;
  cashCycle: number | null;
  safetyMarginUnavailableReason: TrendMetricSnapshot["unavailableReason"] | null;
  safetyMarginUnavailableMessage: string | null;
  safetyMarginMissingInputMarker: number | null;
  safetyMarginNotApplicableMarker: number | null;
};

export function buildTrendChartData(periods: TrendChartPeriod[]): TrendChartDataPoint[] {
  return periods.map(snapshot => {
    const safetyMarginMetric = snapshot.metrics.safetyMargin;
    const unavailableReason = safetyMarginMetric?.value == null
      ? safetyMarginMetric?.unavailableReason ?? null
      : null;

    return {
      period: snapshot.period,
      netRevenue: snapshot.metrics.netRevenue?.value ?? null,
      contributionMargin: snapshot.metrics.contributionMargin?.value ?? null,
      operatingResult: snapshot.metrics.operatingResult?.value ?? null,
      safetyMargin: safetyMarginMetric?.value ?? null,
      cashCycle: snapshot.metrics.cashCycle?.value ?? null,
      safetyMarginUnavailableReason: unavailableReason,
      safetyMarginUnavailableMessage: getSafetyMarginUnavailableMessage(safetyMarginMetric),
      safetyMarginMissingInputMarker: unavailableReason === "missing_inputs" ? 0 : null,
      safetyMarginNotApplicableMarker: unavailableReason === "not_applicable" ? 0 : null,
    };
  });
}

function TrendChart({ periods }: { periods: TrendChartPeriod[] }) {
  const chartData = buildTrendChartData(periods);
  const hasCashCycle = chartData.some(snapshot => snapshot.cashCycle !== null);
  const hasMissingSafetyMargin = chartData.some(
    snapshot => snapshot.safetyMarginUnavailableReason === "missing_inputs",
  );
  const hasNotApplicableSafetyMargin = chartData.some(
    snapshot => snapshot.safetyMarginUnavailableReason === "not_applicable",
  );
  const safetyValues = chartData
    .map(snapshot => snapshot.safetyMargin)
    .filter((value): value is number => value !== null);
  const safetyMin = safetyValues.length > 0 ? Math.min(...safetyValues) : 0;
  const safetyMax = safetyValues.length > 0 ? Math.max(...safetyValues) : 35;
  const safetyDomain: [number, number] = [
    Math.min(0, Math.floor(safetyMin / 5) * 5),
    Math.max(35, Math.ceil(safetyMax / 5) * 5),
  ];

  const FinancialTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs">
        <p className="font-semibold text-foreground mb-2">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} className="text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: entry.color }} />
            {entry.name}: <strong className="text-foreground">{formatTrendValue(entry.value, "BRL")}</strong>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={v => v === 0 ? "0" : `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={2} />
          <Tooltip content={<FinancialTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="netRevenue" name="Receita Líquida" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
          <Bar dataKey="contributionMargin" name="Margem de Contribuição" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
          <Bar dataKey="operatingResult" name="Resultado Operacional" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <div className="border-t border-border/60 pt-4" data-testid="chart-safety-margin">
        <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-foreground">Margem de Segurança</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Evolução percentual e faixas de classificação
              {hasCashCycle ? " · Ciclo de Caixa em dias" : ""}
            </p>
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" />Margem de Segurança
            </span>
            {hasMissingSafetyMargin && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full border-2 border-amber-500" />
                Dados incompletos
              </span>
            )}
            {hasNotApplicableSafetyMargin && (
              <span className="inline-flex items-center gap-1">
                <span className="text-slate-400 font-semibold leading-none">×</span>
                Não aplicável
              </span>
            )}
            {hasCashCycle && (
              <span className="inline-flex items-center gap-1">
                <span className="h-0.5 w-3 bg-violet-500" />Ciclo de Caixa
              </span>
            )}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={chartData} margin={{ top: 16, right: hasCashCycle ? 18 : 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis
              yAxisId="safety"
              domain={safetyDomain}
              tickFormatter={value => `${value}%`}
              tick={{ fontSize: 10 }}
              width={42}
            />
            {hasCashCycle && (
              <YAxis
                yAxisId="cash"
                orientation="right"
                tickFormatter={value => `${value}d`}
                tick={{ fontSize: 10 }}
                width={38}
              />
            )}
            <ReferenceLine
              yAxisId="safety"
              y={0}
              stroke="#ef4444"
              strokeDasharray="4 3"
              label={{ value: "0% · Péssimo", position: "insideTopRight", fill: "#ef4444", fontSize: 10 }}
            />
            <ReferenceLine
              yAxisId="safety"
              y={10}
              stroke="#f97316"
              strokeDasharray="4 3"
              label={{ value: "10% · Ruim", position: "insideTopRight", fill: "#f97316", fontSize: 10 }}
            />
            <ReferenceLine
              yAxisId="safety"
              y={20}
              stroke="#eab308"
              strokeDasharray="4 3"
              label={{ value: "20% · Aceitável", position: "insideTopRight", fill: "#ca8a04", fontSize: 10 }}
            />
            <ReferenceLine
              yAxisId="safety"
              y={35}
              stroke="#3b82f6"
              strokeDasharray="4 3"
              label={{ value: "35% · Bom", position: "insideTopRight", fill: "#3b82f6", fontSize: 10 }}
            />
            <Tooltip
              content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as TrendChartDataPoint | undefined;
                if (!point) return null;
                const visiblePayload = payload.filter((entry: any) =>
                  !["safetyMarginMissingInputMarker", "safetyMarginNotApplicableMarker"].includes(entry.dataKey)
                  && entry.value !== null
                  && entry.value !== undefined,
                );
                if (!visiblePayload.length && !point.safetyMarginUnavailableMessage) return null;
                return (
                  <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs">
                    <p className="font-semibold text-foreground mb-2">{label}</p>
                    {point.safetyMarginUnavailableMessage && (
                      <p className="text-muted-foreground mb-1.5 max-w-[240px]">
                        <span
                          className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                            point.safetyMarginUnavailableReason === "missing_inputs"
                              ? "bg-amber-500"
                              : "bg-slate-400"
                          }`}
                        />
                        Margem de Segurança: <strong className="text-foreground">
                          {point.safetyMarginUnavailableMessage}
                        </strong>
                      </p>
                    )}
                    {visiblePayload.map((entry: any) => (
                      <p key={entry.dataKey} className="text-muted-foreground">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: entry.color }} />
                        {entry.name}: <strong className="text-foreground">
                          {formatTrendValue(entry.value, entry.dataKey === "cashCycle" ? "days" : "pct")}
                        </strong>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Area
              yAxisId="safety"
              type="monotone"
              dataKey="safetyMargin"
              name="Margem de Segurança"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.16}
              strokeWidth={2.5}
              connectNulls={false}
              activeDot={{ r: 4 }}
              dot={(props: any) => {
                const point = props.payload as TrendChartDataPoint | undefined;
                if (!point || point.safetyMargin === null || props.cx == null || props.cy == null) {
                  return <g />;
                }
                return (
                  <circle
                    data-testid={`safety-margin-valid-marker-${point.period}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={3.5}
                    fill="#f59e0b"
                    stroke="hsl(var(--card))"
                    strokeWidth={1.5}
                  />
                );
              }}
            />
            {hasMissingSafetyMargin && (
              <Scatter
                yAxisId="safety"
                dataKey="safetyMarginMissingInputMarker"
                name="Margem de Segurança (dados incompletos)"
                fill="#f59e0b"
                legendType="none"
                shape={(props: any) => {
                  if (props.cx == null || props.cy == null) return <g />;
                  return (
                    <circle
                      data-testid={`safety-margin-missing-input-marker-${props.payload?.period ?? "unknown"}`}
                      cx={props.cx}
                      cy={props.cy}
                      r={5}
                      fill="hsl(var(--card))"
                      stroke="#f59e0b"
                      strokeWidth={2}
                    />
                  );
                }}
              />
            )}
            {hasNotApplicableSafetyMargin && (
              <Scatter
                yAxisId="safety"
                dataKey="safetyMarginNotApplicableMarker"
                name="Margem de Segurança (não aplicável)"
                fill="#94a3b8"
                legendType="none"
                shape={(props: any) => {
                  if (props.cx == null || props.cy == null) return <g />;
                  return (
                    <g
                      data-testid={`safety-margin-not-applicable-marker-${props.payload?.period ?? "unknown"}`}
                      stroke="#94a3b8"
                      strokeWidth={2}
                    >
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={7}
                        fill="transparent"
                        stroke="transparent"
                        pointerEvents="all"
                      />
                      <line x1={props.cx - 4} y1={props.cy - 4} x2={props.cx + 4} y2={props.cy + 4} />
                      <line x1={props.cx + 4} y1={props.cy - 4} x2={props.cx - 4} y2={props.cy + 4} />
                    </g>
                  );
                }}
              />
            )}
            {hasCashCycle && (
              <Line
                yAxisId="cash"
                type="monotone"
                dataKey="cashCycle"
                name="Ciclo de Caixa"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TrendTable({ periods }: {
  periods: Array<{ period: string; metrics: Record<string, TrendMetricSnapshot> }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-44">Indicador</th>
            {periods.map(snapshot => (
              <th key={snapshot.period} className="pb-2 px-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {snapshot.period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TREND_METRIC_LABELS.map(({ key, label, unit, invertDelta }) => (
            <tr key={key} className="border-b border-border/50 last:border-0">
              <td className="py-2.5 pr-3 text-sm text-muted-foreground">{label}</td>
              {periods.map((snapshot, index) => {
                const metric = snapshot.metrics[key];
                const delta = metric?.delta ?? null;
                // For inverted metrics (e.g. costs, cashCycle), lower is better
                const improved = delta !== null && (invertDelta ? delta < 0 : delta > 0);
                const declined = delta !== null && (invertDelta ? delta > 0 : delta < 0);

                // Safety margin classification badge
                const safetyClass = key === "safetyMargin"
                  ? classifyMargemSeguranca(metric?.value ?? null)
                  : null;
                const safetyStyle = safetyClass ? SAFETY_MARGIN_CLASS_STYLE[safetyClass] : null;
                const safetyMarginUnavailableMessage = key === "safetyMargin"
                  ? getSafetyMarginUnavailableMessage(metric)
                  : null;

                return (
                  <td key={snapshot.period} className="py-2.5 px-2 text-right align-top">
                    <div className="text-sm font-medium text-foreground">
                      {safetyMarginUnavailableMessage ? (
                        <UiTooltip>
                          <UiTooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-muted-foreground underline decoration-dotted underline-offset-4"
                              aria-label={`Margem de Segurança: ${safetyMarginUnavailableMessage}`}
                            >
                              — <Info className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </UiTooltipTrigger>
                          <UiTooltipContent>
                            {safetyMarginUnavailableMessage}
                          </UiTooltipContent>
                        </UiTooltip>
                      ) : formatTrendValue(metric?.value ?? null, unit)}
                    </div>
                    {safetyStyle && safetyClass && (
                      <div className="mt-0.5 flex justify-end">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${safetyStyle.bg} ${safetyStyle.text}`}>
                          {safetyClass}
                        </span>
                      </div>
                    )}
                    {index > 0 && delta !== null && (
                      <div className={`text-[11px] ${improved ? "text-emerald-600" : declined ? "text-red-500" : "text-muted-foreground"}`}>
                        {delta > 0 ? "+" : delta < 0 ? "−" : ""}
                        {formatTrendValue(Math.abs(delta), unit)}
                        {metric?.deltaPct !== null && ` (${pctStr(metric?.deltaPct ?? null)})`}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main panel ──────────────────────────────────────────────────────── */
export default function BridgePanel({ companyId, companyName }: BridgePanelProps) {
  const [location, setLocation] = useLocation();
  const search = useSearch();

  const searchParams = new URLSearchParams(search);
  const periodBase = searchParams.get("periodBase") ?? "";
  const periodComp = searchParams.get("periodComp") ?? "";
  const trendStart = searchParams.get("trendStart") ?? "";
  const trendEnd = searchParams.get("trendEnd") ?? "";
  const userChangedPeriodsRef = useRef(false);
  const restoredPairRef = useRef<string | null>(null);
  const lastCompanyIdRef = useRef(companyId);

  const setPeriodBase = useCallback((val: string) => {
    userChangedPeriodsRef.current = true;
    setStalePeriod(null);
    const next = new URLSearchParams(search);
    if (val) next.set("periodBase", val); else next.delete("periodBase");
    const query = next.toString();
    setLocation(`${location}${query ? `?${query}` : ""}`, { replace: true });
  }, [location, search, setLocation]);

  const setPeriodComp = useCallback((val: string) => {
    userChangedPeriodsRef.current = true;
    setStalePeriod(null);
    const next = new URLSearchParams(search);
    if (val) next.set("periodComp", val); else next.delete("periodComp");
    const query = next.toString();
    setLocation(`${location}${query ? `?${query}` : ""}`, { replace: true });
  }, [location, search, setLocation]);

  const [result, setResult]         = useState<any>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [stalePeriod, setStalePeriod] = useState<{ base?: string; comp?: string } | null>(null);
  const [view, setView]             = useState<"comparison" | "trend">("comparison");
  const [staleTrendPeriod, setStaleTrendPeriod] = useState<{ start?: string; end?: string } | null>(null);
  const [trendResult, setTrendResult] = useState<PeriodTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);

  // ── AI streaming state ───────────────────────────────────────────────
  const [aiText, setAiText]       = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]     = useState<string | null>(null);
  const [aiHasRun, setAiHasRun]   = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const { data: periods = [], isLoading: periodsLoading, isSuccess: periodsSuccess } = useQuery({
    queryKey: getListPeriodsQueryKey(companyId),
    queryFn:  () => listPeriods(companyId),
    enabled:  !!companyId,
  });

  const periodsAscending = [...periods].sort((a, b) =>
    a.period.localeCompare(b.period, undefined, { numeric: true }),
  );

  const updateTrendParams = useCallback((updates: { start?: string; end?: string }) => {
    const next = new URLSearchParams(search);
    if (updates.start !== undefined) {
      if (updates.start) next.set("trendStart", updates.start); else next.delete("trendStart");
    }
    if (updates.end !== undefined) {
      if (updates.end) next.set("trendEnd", updates.end); else next.delete("trendEnd");
    }
    const query = next.toString();
    setLocation(`${location}${query ? `?${query}` : ""}`, { replace: true });
  }, [location, search, setLocation]);

  const setTrendStart = useCallback((val: string) => {
    setStaleTrendPeriod(null);
    setTrendError(null);
    setTrendResult(null);
    updateTrendParams({ start: val });
  }, [updateTrendParams]);

  const setTrendEnd = useCallback((val: string) => {
    setStaleTrendPeriod(null);
    setTrendError(null);
    setTrendResult(null);
    updateTrendParams({ end: val });
  }, [updateTrendParams]);

  const setTrendRange = useCallback((start: string, end: string) => {
    setStaleTrendPeriod(null);
    setTrendError(null);
    setTrendResult(null);
    updateTrendParams({ start, end });
  }, [updateTrendParams]);

  useEffect(() => {
    if (periodsAscending.length < 3 || trendStart || trendEnd) return;
    setTrendRange(periodsAscending[0].period, periodsAscending[periodsAscending.length - 1].period);
  }, [periodsAscending, trendStart, trendEnd, setTrendRange]);

  const handleCompare = useCallback(async (base = periodBase, comp = periodComp) => {
    if (!base || !comp) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setAiText("");
    setAiHasRun(false);
    try {
      const res = await fetch(`/api/companies/${companyId}/bridge-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ periodBase: base, periodComp: comp }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `Erro ${res.status}`);
      }
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message ?? "Erro ao comparar períodos");
    } finally {
      setLoading(false);
    }
  }, [companyId, periodBase, periodComp]);

  const handleTrend = useCallback(async (start = trendStart, end = trendEnd) => {
    if (!start || !end || start === end || staleTrendPeriod) return;
    setTrendLoading(true);
    setTrendError(null);
    setTrendResult(null);
    try {
      const nextTrendResult = await comparePeriodsTrend(companyId, { periodStart: start, periodEnd: end });
      const coverageError = validateTrendPeriodCoverage(start, end, nextTrendResult.periods);
      if (coverageError) {
        setTrendError(coverageError);
        return;
      }
      setTrendResult(nextTrendResult);
    } catch (e: any) {
      setTrendError(
        isTrendRangeNotFound(e)
          ? STALE_TREND_RANGE_ERROR
          : e.data?.error ?? e.message ?? "Erro ao analisar a tendência",
      );
    } finally {
      setTrendLoading(false);
    }
  }, [companyId, trendStart, trendEnd, staleTrendPeriod]);

  // Restore URL-backed comparisons, but keep an explicit Compare click for
  // pairs selected interactively in this mounted panel.
  useEffect(() => {
    if (lastCompanyIdRef.current !== companyId) {
      lastCompanyIdRef.current = companyId;
      userChangedPeriodsRef.current = false;
      restoredPairRef.current = null;
      setStalePeriod(null);
      setStaleTrendPeriod(null);
      setTrendResult(null);
      setTrendError(null);
    }
  }, [companyId]);
  useEffect(() => {
    if (!periodBase || !periodComp || !companyId) return;
    if (userChangedPeriodsRef.current) return;
    // Only validate once the periods list has been successfully fetched.
    // Leaving periodsSuccess=false means a failed/pending request doesn't
    // falsely flag periods as removed, and restoredPairRef stays unset so a
    // successful retry re-enters this effect and validates properly.
    if (userChangedPeriodsRef.current) return;
    if (!periodsSuccess || periods.length === 0) return;

    // An empty list is also treated as not ready, so loading/empty states
    // cannot falsely report URL-backed periods as deleted.
    const staleComparisonPeriod = resolveStaleComparisonPeriod({
      periodBase,
      periodComp,
      periods,
      periodsSuccess,
    });
    if (staleComparisonPeriod) {
      setStalePeriod(staleComparisonPeriod);
      return;
    }

    // Both periods exist — clear any prior stale warning.
    setStalePeriod(null);

    // Guard handleCompare with the pairKey ref so the API call fires only
    // once per (companyId, base, comp) triple even as periods keeps updating.
    const pairKey = `${companyId}:${periodBase}:${periodComp}`;
    if (restoredPairRef.current === pairKey) return;
    restoredPairRef.current = pairKey;
    void handleCompare(periodBase, periodComp);
  }, [companyId, periodBase, periodComp, periods, periodsSuccess, handleCompare]);

  useEffect(() => {
    if (!companyId || !periodsSuccess) return;

    // Validate URL-restored trend boundaries against the current period list.
    // This also runs on background refetches so a range deleted after initial
    // load cannot leave a misleading result visible.
    const periodSet = new Set(periods.map(p => p.period));
    const missingStart = trendStart && !periodSet.has(trendStart) ? trendStart : undefined;
    const missingEnd = trendEnd && !periodSet.has(trendEnd) ? trendEnd : undefined;
    if (missingStart || missingEnd) {
      setStaleTrendPeriod({ start: missingStart, end: missingEnd });
      setTrendResult(null);
      return;
    }

    setStaleTrendPeriod(null);
    const coverageError = validateTrendPeriodCoverage(trendStart, trendEnd, periods, {
      allowPeriodsOutsideRange: true,
    });
    if (coverageError) {
      setTrendResult(null);
      setTrendError(coverageError);
      return;
    }

    setTrendError((current) => current === STALE_TREND_RANGE_ERROR ? null : current);
  }, [companyId, trendStart, trendEnd, periods, periodsSuccess]);

  const runAiAnalysis = async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setAiLoading(true);
    setAiError(null);
    setAiText("");
    setAiHasRun(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/bridge-analysis-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ periodBase, periodComp }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "text") setAiText(t => t + evt.text);
            else if (evt.type === "error") setAiError(evt.error);
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setAiError(e.message ?? "Erro desconhecido");
    } finally {
      setAiLoading(false);
    }
  };

  function handlePrint() { window.print(); }

  function handleDownloadPdf() {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const marginL = 20, marginR = 20, pageW = 210, contentW = pageW - marginL - marginR;
    let y = 20;
    const checkPage = (need = 8) => { if (y + need > 280) { doc.addPage(); y = 20; } };

    // Header
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(30, 30, 30);
    doc.text("Análise de Evolução", marginL, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(80, 80, 80);
    if (companyName) { doc.text(companyName, marginL, y); y += 5; }
    doc.text(`${result?.periodBase ?? periodBase} → ${result?.periodComp ?? periodComp}`, marginL, y); y += 5;
    doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`, marginL, y); y += 4;
    doc.setDrawColor(200, 200, 200); doc.line(marginL, y, pageW - marginR, y); y += 6;

    // AI narrative
    doc.setTextColor(30, 30, 30);
    for (const raw of aiText.split("\n")) {
      checkPage(7);
      const line = raw.trimEnd();
      if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
        y += 3; checkPage(8);
        doc.setFont("helvetica", "bold"); doc.setFontSize(11);
        doc.text(line.trim().replace(/\*\*/g, ""), marginL, y); y += 6;
        doc.setFont("helvetica", "normal"); continue;
      }
      if (line.trim() === "") { y += 3; continue; }
      const clean = line.replace(/\*\*/g, "");
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      const isBullet = clean.trim().startsWith("- ");
      const indentX = isBullet ? marginL + 5 : marginL;
      const displayText = isBullet ? `• ${clean.trim().slice(2)}` : clean;
      for (const wl of doc.splitTextToSize(displayText, contentW - (isBullet ? 5 : 0))) {
        checkPage(5); doc.text(wl, indentX, y); y += 5;
      }
    }

    // Trend metrics table
    if (trendResult?.periods.length) {
      y += 3;
      y = ensureTrendMetricsPdfPage(doc, y);
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30, 30, 30);
      doc.text("Evolução dos indicadores financeiros", marginL, y); y += 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100);
      doc.text(
        `${trendResult.periodStart} → ${trendResult.periodEnd} · ${trendResult.periods.length} períodos com dados`,
        marginL,
        y,
      );
      y += 6;

      const labelW = 48;
      const trendTable = drawTrendMetricsPdf(doc, trendResult.periods, {
        startY: y,
        marginL,
        marginR,
        pageW,
        labelW,
      });
      y = trendTable.endY;
      y += 3;
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(160, 160, 160);
      doc.text("GESAIA — Plataforma de Inteligência Gerencial", marginL, 290);
      doc.text(`Página ${p} de ${pageCount}`, pageW - marginR, 290, { align: "right" });
    }
    const safeName = (companyName ?? "empresa").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    doc.save(`analise_evolucao_${safeName}_${periodBase}_${periodComp}.pdf`);
  }

  const s = result?.summary;

  return (
    <div className="space-y-6">
      {/* Header + diferenciação + selectors */}
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-primary" />
            Análise de Evolução
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Compare <strong>dois períodos</strong> em detalhe ou acompanhe a <strong>tendência</strong> de métricas-chave ao longo de vários períodos.
            {" "}<span className="text-muted-foreground/70">Use o <strong>Diagnóstico</strong> para a saúde atual de um único período.</span>
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted w-fit no-print">
          <Button size="sm" variant={view === "comparison" ? "default" : "ghost"} onClick={() => setView("comparison")}>
            <GitCompare className="w-4 h-4 mr-2" />Comparação
          </Button>
          <Button size="sm" variant={view === "trend" ? "default" : "ghost"} onClick={() => setView("trend")}>
            <TrendingUp className="w-4 h-4 mr-2" />Tendência
          </Button>
        </div>

        {view === "comparison" ? (
          <div className="flex items-center gap-2 flex-wrap no-print">
            <select
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
              value={periodBase}
              onChange={e => setPeriodBase(e.target.value)}
            >
              <option value="">Período base</option>
              {periods.map(p => <option key={p.period} value={p.period}>{p.period}</option>)}
            </select>
            <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <select
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
              value={periodComp}
              onChange={e => setPeriodComp(e.target.value)}
            >
              <option value="">Período comparativo</option>
              {periods.map(p => <option key={p.period} value={p.period}>{p.period}</option>)}
            </select>
            <Button
              size="sm"
              disabled={!periodBase || !periodComp || periodBase === periodComp || loading}
              onClick={() => handleCompare()}
            >
              {loading
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <GitCompare className="w-4 h-4 mr-2" />}
              Comparar
            </Button>
          </div>
        ) : (
          <div className="space-y-2 no-print">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
                value={trendStart}
                onChange={e => setTrendStart(e.target.value)}
              >
                <option value="">Período inicial</option>
                {periodsAscending.map(p => <option key={p.period} value={p.period}>{p.period}</option>)}
              </select>
              <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <select
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
                value={trendEnd}
                onChange={e => setTrendEnd(e.target.value)}
              >
                <option value="">Período final</option>
                {periodsAscending.map(p => <option key={p.period} value={p.period}>{p.period}</option>)}
              </select>
              <Button
                size="sm"
                disabled={!trendStart || !trendEnd || trendStart >= trendEnd || !!staleTrendPeriod || trendLoading}
                onClick={() => handleTrend()}
              >
                {trendLoading
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <TrendingUp className="w-4 h-4 mr-2" />}
                Ver tendência
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Selecione pelo menos 3 períodos com dados para ver a evolução período a período.
            </p>
          </div>
        )}
      </div>

      {/* Empty / error */}
      {view === "comparison" && !result && !loading && (
        <Card className={stalePeriod ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : undefined}>
          <CardContent className="flex flex-col items-center py-14 text-center">
            {stalePeriod ? (
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
            ) : (
              <GitCompare className="w-10 h-10 text-muted-foreground/30 mb-3" />
            )}
            <p className="font-medium text-foreground">
              {stalePeriod ? "Período salvo não está mais disponível" : "Selecione dois períodos para comparar"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {stalePeriod ? (
                <span className="text-amber-700 dark:text-amber-400">
                  {[stalePeriod.base && `"${stalePeriod.base}"`, stalePeriod.comp && `"${stalePeriod.comp}"`]
                    .filter(Boolean)
                    .join(" e ")}{" "}
                  {stalePeriod.base && stalePeriod.comp ? "foram removidos" : "foi removido"} por um administrador.
                  {" "}Escolha um novo par de períodos acima para continuar.
                </span>
              ) : error ? (
                <span className="text-red-500">{error}</span>
              ) : (
                "A análise decompõe exatamente de onde veio a variação no resultado — efeito volume, margem e custo fixo."
              )}
            </p>
            {!stalePeriod && periods.length < 2 && (
              <p className="text-xs text-muted-foreground/70 mt-3">
                Você precisa de pelo menos 2 períodos com dados inseridos.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {view === "comparison" && loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {view === "trend" && !trendResult && !trendLoading && (
        <Card className={staleTrendPeriod ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : undefined}>
          <CardContent className="flex flex-col items-center py-14 text-center">
            {staleTrendPeriod ? (
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
            ) : (
              <TrendingUp className="w-10 h-10 text-muted-foreground/30 mb-3" />
            )}
            <p className="font-medium text-foreground">
              {staleTrendPeriod ? "Intervalo salvo não está mais disponível" : "Selecione um intervalo para acompanhar a tendência"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              {staleTrendPeriod ? (
                <span className="text-amber-700 dark:text-amber-400">
                  {[staleTrendPeriod.start && `"${staleTrendPeriod.start}"`, staleTrendPeriod.end && `"${staleTrendPeriod.end}"`]
                    .filter(Boolean)
                    .join(" e ")}{" "}
                  {staleTrendPeriod.start && staleTrendPeriod.end ? "foram removidos" : "foi removido"} por um administrador.
                  {" "}Escolha um novo intervalo acima para continuar.
                </span>
              ) : trendError
                ? <span className="text-red-500">{trendError}</span>
                : "Veja receitas, margens e resultados evoluírem em todos os períodos intermediários."}
            </p>
            {!staleTrendPeriod && periods.length < 3 && (
              <p className="text-xs text-muted-foreground/70 mt-3">
                Você precisa de pelo menos 3 períodos com dados inseridos.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {view === "trend" && trendLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {view === "trend" && trendResult && !trendLoading && (
        <>
          <Card>
            <CardContent className="pt-5 pb-3">
              <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-foreground">Evolução dos principais resultados</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {trendResult.periodStart} → {trendResult.periodEnd} · {trendResult.periods.length} períodos com dados
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Período a período</Badge>
                  <Button variant="outline" size="sm" onClick={handleDownloadPdf} title="Baixar PDF">
                    <Download className="w-4 h-4 mr-2" />PDF
                  </Button>
                </div>
              </div>
              <TrendChart periods={trendResult.periods} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-2">
              <p className="text-sm font-semibold text-foreground mb-1">Detalhamento da tendência</p>
              <p className="text-xs text-muted-foreground mb-3">A segunda linha em cada célula mostra a variação em relação ao período anterior.</p>
              <TrendTable periods={trendResult.periods} />
            </CardContent>
          </Card>
        </>
      )}

      {view === "comparison" && result && !loading && (
        <>
          {/* Diagnosis banner */}
          <Card className={`border ${
            result.diagnosis.isLeaking   ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" :
            result.diagnosis.isImproving ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20" :
            "border-red-300 bg-red-50 dark:bg-red-950/20"
          }`}>
            <CardContent className="p-4 flex gap-3">
              {result.diagnosis.isLeaking ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              ) : result.diagnosis.isImproving ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {result.periodBase} → {result.periodComp}
                  </span>
                  {result.diagnosis.isLeaking && (
                    <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 border-amber-300">
                      Vazamento de Resultado
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-foreground leading-relaxed">{result.narrative}</p>
              </div>
            </CardContent>
          </Card>

          {/* Bridge waterfall chart */}
          <Card>
            <CardContent className="pt-5 pb-2">
              <div className="flex items-center gap-2 mb-4">
                <p className="text-sm font-semibold text-foreground">Decomposição do Δ Resultado Operacional</p>
                <div className="group relative">
                  <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  <div className="absolute left-0 bottom-5 hidden group-hover:block bg-card border border-border rounded-lg p-2 text-xs text-muted-foreground w-64 z-10 shadow-lg">
                    Os três efeitos somam exatamente ao Δ Resultado Operacional real.
                  </div>
                </div>
              </div>
              <WaterfallChart bridge={result.bridge} deltaResult={s?.operatingResult?.delta ?? 0} />
              {/* Bridge legend */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                {result.bridge.map((b: any) => (
                  <div key={b.label} className={`rounded-lg px-3 py-2 border ${
                    b.value > 0 ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
                                : b.value < 0 ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                                : "bg-muted border-border"
                  }`}>
                    <p className="text-xs text-muted-foreground">{b.label}</p>
                    <p className={`text-sm font-bold ${b.value > 0 ? "text-emerald-700 dark:text-emerald-400" : b.value < 0 ? "text-red-600" : "text-foreground"}`}>
                      {b.value >= 0 ? "+" : "−"}{brl(b.value)}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5 leading-tight">{b.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Revenue decomposition (if available) */}
          {result.revenueDecomposition && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-sm font-semibold text-foreground mb-3">Decomposição do Δ Receita</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg px-3 py-2 border border-border bg-muted/30">
                    <p className="text-xs text-muted-foreground">Efeito Volume (clientes)</p>
                    <p className={`text-sm font-bold ${result.revenueDecomposition.volumeEffect >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
                      {result.revenueDecomposition.volumeEffect >= 0 ? "+" : "−"}{brl(result.revenueDecomposition.volumeEffect)}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">Δ clientes × ticket base</p>
                  </div>
                  <div className="rounded-lg px-3 py-2 border border-border bg-muted/30">
                    <p className="text-xs text-muted-foreground">Efeito Preço (ticket médio)</p>
                    <p className={`text-sm font-bold ${result.revenueDecomposition.priceEffect >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
                      {result.revenueDecomposition.priceEffect >= 0 ? "+" : "−"}{brl(result.revenueDecomposition.priceEffect)}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">Δ ticket × clientes novos</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary table */}
          <Card>
            <CardContent className="pt-4 pb-2 overflow-x-auto">
              <p className="text-sm font-semibold text-foreground mb-3">Comparativo Detalhado</p>
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-44">Indicador</th>
                    <th className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">{result.periodBase}</th>
                    <th className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">{result.periodComp}</th>
                    <th className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {s?.grossRevenue    && <SummaryRow label="Receita Bruta"          {...s.grossRevenue}    />}
                  <SummaryRow label="Receita Líquida"         {...s.netRevenue}          />
                  <SummaryRow label="Margem de Contribuição"  {...s.contributionMargin}  />
                  <SummaryRow label="MC %"                    {...s.mcPct}               unit="pct" />
                  <SummaryRow label="Custos Fixos"            {...s.fixedCosts}           invert />
                  <SummaryRow label="Resultado Operacional"   {...s.operatingResult}     />
                  {s?.ebitda          && <SummaryRow label="EBITDA"                 {...s.ebitda}          />}
                  {s?.netProfit       && <SummaryRow label="Lucro Líquido"          {...s.netProfit}       />}
                  {s?.activeCustomers && <SummaryRow label="Clientes Ativos"        {...s.activeCustomers}  unit="count" />}
                  {s?.averageTicket   && <SummaryRow label="Ticket Médio"           {...s.averageTicket}   />}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* ── Análise IA ────────────────────────────────────────────── */}
          <div className="border-t border-border pt-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap no-print">
              <div>
                <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Brain className="w-4 h-4 text-primary" />
                  Análise por IA
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Explica o que mudou, por que mudou e o que fazer a respeito.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {((aiHasRun && !aiLoading && aiText) || trendResult) && (
                  <>
                    <Button variant="outline" size="sm" onClick={handleDownloadPdf} title="Baixar PDF">
                      <Download className="w-4 h-4 mr-2" />PDF
                    </Button>
                    {aiHasRun && !aiLoading && aiText && (
                      <Button variant="outline" size="sm" onClick={handlePrint} title="Imprimir">
                        <Printer className="w-4 h-4 mr-2" />Imprimir
                      </Button>
                    )}
                  </>
                )}
                <Button
                  size="sm"
                  onClick={runAiAnalysis}
                  disabled={aiLoading}
                  variant={aiHasRun ? "outline" : "default"}
                >
                  {aiLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisando…</>
                    : aiHasRun
                      ? <><Brain className="w-4 h-4 mr-2" />Refazer</>
                      : <><Brain className="w-4 h-4 mr-2" />Analisar com IA</>}
                </Button>
              </div>
            </div>

            {/* Print-only header for AI section */}
            <div className="print-only hidden">
              <h2 className="text-xl font-bold">Análise de Evolução — GESAIA</h2>
              {companyName && <p className="text-sm text-gray-600 mt-1">{companyName}</p>}
              <p className="text-sm text-gray-500">{result.periodBase} → {result.periodComp}</p>
              <p className="text-xs text-gray-400 mt-1">
                Gerado em {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
              </p>
              <hr className="mt-3 mb-4" />
            </div>

            {aiError && (
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="p-4 text-sm text-destructive">{aiError}</CardContent>
              </Card>
            )}

            {(aiText || aiLoading) && (
              <Card>
                <CardContent className="p-6">
                  {aiText
                    ? <EvolutionText text={aiText} />
                    : <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />Gerando análise…
                      </div>}
                  {aiLoading && aiText && (
                    <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 rounded-sm align-middle" />
                  )}
                </CardContent>
              </Card>
            )}

            {!aiHasRun && (
              <Card className="border-dashed">
                <CardContent className="p-8 flex flex-col items-center gap-2 text-center">
                  <Brain className="w-8 h-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Clique em <strong>Analisar com IA</strong> para receber uma narrativa explicando
                    as causas das variações e recomendações para o próximo período.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
