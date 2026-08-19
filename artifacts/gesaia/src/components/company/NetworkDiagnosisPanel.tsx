import React, { useState, useRef } from "react";
import jsPDF from "jspdf";
import {
  Brain, Loader2, Trophy, TrendingUp, TrendingDown, Minus,
  Printer, Download, AlertTriangle, Star, Users, ChevronDown, FileText,
} from "lucide-react";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ── Types ─────────────────────────────────────────────────────────────── */
interface GoldEntry { value: number; companyId: number; companyName: string }
interface MetricDef { key: string; label: string; higherIsBetter: boolean }
interface UnitMetrics { [key: string]: number | null }
interface RankedUnit {
  companyId: number; companyName: string; hasData: boolean;
  metrics: UnitMetrics | null; gaps: Record<string, number | null> | null;
  gapsPct: Record<string, number | null> | null; rank: number;
}
interface RankingData {
  networkId: number; networkName: string; period: string; prevPeriod?: string | null;
  unitCount: number; unitsWithData: number;
  goldStandard: Record<string, GoldEntry>;
  benchmark?: Record<string, number | null>;
  idealModel?: Record<string, number>;
  metricDefs: MetricDef[];
  units: RankedUnit[];
}
interface GapHistoryUnit {
  companyId: number; companyName: string; hasData: boolean;
  gapsPct: Record<string, number | null> | null;
}
interface GapHistoryPoint {
  period: string; unitsWithData: number; goldStandardUnitCount?: number; units: GapHistoryUnit[];
}
interface GapHistoryData {
  networkId: number; metricDefs: MetricDef[]; points: GapHistoryPoint[];
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
const brl = (v: number | null | undefined) =>
  v != null ? `R$ ${Math.round(v).toLocaleString("pt-BR")}` : "—";
const pct = (v: number | null | undefined) => v != null ? `${v.toFixed(1)}%` : "—";
const num = (v: number | null | undefined) => v != null ? v.toFixed(0) : "—";

function fmtMetric(def: MetricDef, v: number | null | undefined) {
  if (v == null) return "—";
  if (def.key === "averageTicket" || def.key === "netRevenue") return brl(v);
  if (def.key === "cashCycle" || def.key === "nps" || def.key === "activeCustomers") return num(v);
  return pct(v);
}

function getWorstGap(unit: RankedUnit, ranking: RankingData) {
  let worstKey: string | null = null;
  let worstAbs = 0;
  for (const def of ranking.metricDefs ?? []) {
    const gapPct = unit.gapsPct?.[def.key];
    const isGold = ranking.goldStandard[def.key]?.companyId === unit.companyId;
    if (gapPct == null || isGold) continue;
    if (Math.abs(gapPct) > worstAbs) {
      worstAbs = Math.abs(gapPct);
      worstKey = def.key;
    }
  }
  return {
    key: worstKey,
    def: ranking.metricDefs?.find(def => def.key === worstKey),
    absPct: worstAbs,
  };
}

function handleDownloadUnitPdf(unit: RankedUnit, ranking: RankingData, networkName: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const mL = 16;
  const mR = 16;
  const pageW = 210;
  const footerY = 288;
  const cW = pageW - mL - mR;
  let y = 20;
  const worstGap = getWorstGap(unit, ranking);

  const checkPage = (need = 8) => {
    if (y + need > footerY - 4) {
      doc.addPage();
      y = 20;
      drawTableHeader();
    }
  };

  const drawTableHeader = () => {
    const columns = [
      { label: "Indicador", width: 49 },
      { label: "Unidade", width: 31 },
      { label: "Padrão Ouro", width: 37 },
      { label: "Gap", width: 24 },
      { label: "Gap %", width: cW - 49 - 31 - 37 - 24 },
    ];
    doc.setFillColor(42, 52, 64);
    doc.rect(mL, y, cW, 9, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    let x = mL;
    for (const column of columns) {
      doc.text(column.label, x + 2, y + 5.8);
      x += column.width;
    }
    y += 9;
  };

  const drawRule = () => {
    doc.setDrawColor(220, 220, 220);
    doc.line(mL, y, pageW - mR, y);
    y += 5;
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 30);
  doc.text("Ficha da Unidade", mL, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  for (const line of doc.splitTextToSize(`Rede: ${networkName}`, cW)) {
    doc.text(line, mL, y);
    y += 5;
  }
  for (const line of doc.splitTextToSize(`Unidade: ${unit.companyName}`, cW)) {
    doc.text(line, mL, y);
    y += 5;
  }
  doc.text(`Período: ${ranking.period}`, mL, y);
  y += 5;
  doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`, mL, y);
  y += 5;
  drawRule();

  // Biggest gap callout
  if (worstGap.def) {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(248, 113, 113);
    doc.roundedRect(mL, y, cW, 18, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(185, 28, 28);
    doc.text("Maior gap da unidade", mL + 4, y + 6.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(127, 29, 29);
    doc.text(
      `${worstGap.def.label}: ${worstGap.absPct.toFixed(1)}% abaixo do Padrão Ouro`,
      mL + 4,
      y + 12.5,
    );
    y += 24;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(70, 70, 70);
    doc.text("A unidade está no Padrão Ouro em todas as métricas calculáveis.", mL, y);
    y += 9;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  doc.text("Indicadores versus Padrão Ouro", mL, y);
  y += 6;
  drawTableHeader();

  const columns = [49, 31, 37, 24, cW - 49 - 31 - 37 - 24];
  for (const def of ranking.metricDefs ?? []) {
    const value = unit.metrics?.[def.key] ?? null;
    const gold = ranking.goldStandard[def.key];
    const gap = unit.gaps?.[def.key] ?? null;
    const gapPct = unit.gapsPct?.[def.key] ?? null;
    const isGold = gold?.companyId === unit.companyId;
    const atGold = isGold || (gap != null && Math.abs(gap) < 0.1);
    const isWorst = def.key === worstGap.key;
    const labelLines = doc.splitTextToSize(def.label, columns[0] - 4);
    const goldLines = gold
      ? doc.splitTextToSize(`${fmtMetric(def, gold.value)} (${gold.companyName})`, columns[2] - 4)
      : ["—"];
    const rowHeight = Math.max(9, labelLines.length * 4 + 5, goldLines.length * 4 + 5);
    checkPage(rowHeight + 1);

    if (isWorst) {
      doc.setFillColor(254, 242, 242);
      doc.rect(mL, y, cW, rowHeight, "F");
    }
    doc.setDrawColor(232, 232, 232);
    doc.line(mL, y + rowHeight, mL + cW, y + rowHeight);
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", isWorst ? "bold" : "normal");
    doc.text(labelLines, mL + 2, y + 5);

    const valueColor = value == null ? [150, 150, 150] : atGold ? [4, 120, 87] : [185, 28, 28];
    doc.setTextColor(valueColor[0], valueColor[1], valueColor[2]);
    doc.setFont("helvetica", "bold");
    doc.text(fmtMetric(def, value), mL + columns[0] + columns[1] - 2, y + 5, { align: "right" });

    doc.setTextColor(90, 90, 90);
    doc.setFont("helvetica", "normal");
    doc.text(goldLines, mL + columns[0] + columns[1] + 2, y + 5);

    doc.setTextColor(atGold ? 4 : 185, atGold ? 120 : 28, atGold ? 87 : 28);
    doc.setFont("helvetica", atGold ? "normal" : "bold");
    doc.text(
      atGold ? "0" : gap == null ? "—" : `−${fmtMetric(def, Math.abs(gap))}`,
      mL + columns[0] + columns[1] + columns[2] + columns[3] - 2,
      y + 5,
      { align: "right" },
    );
    doc.text(
      atGold ? "no padrão" : gapPct == null ? "—" : `−${Math.abs(gapPct).toFixed(1)}%`,
      mL + cW - 2,
      y + 5,
      { align: "right" },
    );
    if (isWorst) {
      doc.setFontSize(7.5);
      doc.setTextColor(185, 28, 28);
      doc.text("MAIOR GAP", mL + cW - 2, y + rowHeight - 2, { align: "right" });
    }
    y += rowHeight;
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(160, 160, 160);
    doc.text("GESAIA — Diagnóstico de Rede", mL, footerY);
    doc.text(`Página ${p} de ${total}`, pageW - mR, footerY, { align: "right" });
  }

  const safeNetwork = networkName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const safeUnit = unit.companyName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  doc.save(`ficha_unidade_${safeNetwork}_${safeUnit}_${ranking.period}.pdf`);
}

/* ── Ficha individual por unidade (gaps vs. padrão ouro) ────────────────── */
function UnitSheet({ unit, ranking }: { unit: RankedUnit; ranking: RankingData }) {
  const [open, setOpen] = useState(false);
  const defs = ranking.metricDefs ?? [];

  const worstGap = getWorstGap(unit, ranking);
  const worstDef = worstGap.def;
  const goldCount = defs.filter(d => ranking.goldStandard[d.key]?.companyId === unit.companyId).length;

  return (
    <Card>
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setOpen(o => !o)}
      >
        <CardContent className="p-4 flex items-center gap-3">
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">{unit.companyName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {goldCount > 0 && <span className="text-amber-600 font-medium">{goldCount} padrão{goldCount > 1 ? "es" : ""} ouro</span>}
              {goldCount > 0 && worstDef && " · "}
              {worstDef && <>maior gap: <strong className="text-red-500">{worstDef.label}</strong> ({worstGap.absPct < 10 ? worstGap.absPct.toFixed(1) : Math.round(worstGap.absPct)}% abaixo do ouro)</>}
              {goldCount === 0 && !worstDef && "sem gaps calculáveis"}
            </p>
          </div>
          <Badge variant="secondary" className="flex-shrink-0">#{unit.rank || "—"}</Badge>
        </CardContent>
      </button>
      {open && (
        <CardContent className="pt-0 pb-4 px-4 overflow-x-auto">
          <div className="flex justify-end mb-3 no-print">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownloadUnitPdf(unit, ranking, ranking.networkName)}
            >
              <Download className="w-4 h-4 mr-2" />PDF da unidade
            </Button>
          </div>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Indicador</th>
                <th className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">Unidade</th>
                <th className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">Padrão Ouro</th>
                <th className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">Gap</th>
                <th className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">Gap %</th>
              </tr>
            </thead>
            <tbody>
              {defs.map(def => {
                const v = unit.metrics?.[def.key];
                const g = ranking.goldStandard[def.key];
                const gap = unit.gaps?.[def.key] ?? null;
                const gapPct = unit.gapsPct?.[def.key] ?? null;
                const isGold = g?.companyId === unit.companyId;
                const atGold = isGold || (gap != null && Math.abs(gap) < 0.1);
                const isWorst = def.key === worstGap.key;
                return (
                  <tr key={def.key} className={`border-b border-border/40 ${isWorst ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                    <td className="py-2 text-foreground">
                      {def.label}
                      {isGold && <Star className="w-3 h-3 text-amber-500 inline ml-1.5 -mt-0.5" />}
                      {isWorst && <span className="ml-1.5 text-[10px] font-semibold text-red-500 uppercase">maior gap</span>}
                    </td>
                    <td className={`py-2 text-right px-2 font-medium tabular-nums ${v == null ? "text-muted-foreground/40" : atGold ? "text-emerald-600" : "text-red-500"}`}>
                      {fmtMetric(def, v)}
                    </td>
                    <td className="py-2 text-right px-2 text-muted-foreground tabular-nums">
                      {g ? <>{fmtMetric(def, g.value)} <span className="text-xs text-muted-foreground/60">({g.companyName})</span></> : "—"}
                    </td>
                    <td className={`py-2 text-right px-2 tabular-nums text-xs font-medium ${atGold ? "text-emerald-600" : gap == null ? "text-muted-foreground/40" : "text-red-500"}`}>
                      {atGold ? "✓" : gap == null ? "—" : `−${Math.abs(gap) < 10 ? Math.abs(gap).toFixed(1) : Math.round(Math.abs(gap))}`}
                    </td>
                    <td className={`py-2 text-right px-2 tabular-nums text-xs font-medium ${atGold ? "text-emerald-600" : gapPct == null ? "text-muted-foreground/40" : "text-red-500"}`}>
                      {atGold ? "no padrão" : gapPct == null ? "—" : `${Math.abs(gapPct) < 10 ? Math.abs(gapPct).toFixed(1) : Math.round(Math.abs(gapPct))}% abaixo`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      )}
    </Card>
  );
}

function GapBadge({ gap, isGold }: { gap: number | null; isGold: boolean }) {
  if (isGold) return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
      <Star className="w-3 h-3" />ouro
    </span>
  );
  if (gap == null) return <span className="text-xs text-muted-foreground/40">—</span>;
  const abs = Math.abs(gap);
  if (abs < 0.1) return <span className="text-xs text-emerald-600 font-medium">no padrão</span>;
  return (
    <span className="text-xs text-red-500 font-medium tabular-nums">
      −{abs < 10 ? abs.toFixed(1) : Math.round(abs)}
    </span>
  );
}

export function GapHistoryChart({
  history,
  error,
  selectedMetric,
  onMetricChange,
}: {
  history: GapHistoryData | null;
  error: string | null;
  selectedMetric: string;
  onMetricChange: (metric: string) => void;
}) {
  const metricDefs = history?.metricDefs ?? [];
  const selectedMetricDef = metricDefs.find(def => def.key === selectedMetric) ?? metricDefs[0];
  const historicalUnits = history?.points[0]?.units ?? [];
  const chartUnits = historicalUnits.filter(unit =>
    history?.points.some(point => point.units.some(historyUnit =>
      historyUnit.companyId === unit.companyId && historyUnit.gapsPct?.[selectedMetric] != null,
    )),
  );
  const chartData = (history?.points ?? []).map(point => {
    const row: Record<string, string | number | null> = { period: point.period };
    for (const unit of chartUnits) {
      const historyUnit = point.units.find(entry => entry.companyId === unit.companyId);
      row[`unit-${unit.companyId}`] = historyUnit?.gapsPct?.[selectedMetric] ?? null;
    }
    return row;
  });
  const benchmarkBaseChanges = (history?.points ?? []).slice(1).flatMap((point, index) => {
    const previousPoint = history!.points[index];
    const previousCount = previousPoint.goldStandardUnitCount ?? previousPoint.unitsWithData;
    const currentCount = point.goldStandardUnitCount ?? point.unitsWithData;
    return previousCount === currentCount
      ? []
      : [{ period: point.period, previousCount, currentCount }];
  });
  const lineColors = ["#2563eb", "#d97706", "#059669", "#7c3aed", "#db2777", "#0891b2", "#dc2626", "#4f46e5"];

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />Evolução do Gap vs. Padrão Ouro
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Cada ponto compara a unidade ao melhor resultado da rede naquele mesmo período. Quanto mais perto de 0%, menor o gap.
            </p>
          </div>
          {metricDefs.length > 0 && (
            <select
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
              value={selectedMetricDef?.key ?? selectedMetric}
              onChange={event => onMetricChange(event.target.value)}
              aria-label="Indicador do gráfico de evolução de gap"
            >
              {metricDefs.map(def => <option key={def.key} value={def.key}>{def.label}</option>)}
            </select>
          )}
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !history ? (
          <div className="h-72 bg-muted rounded-xl animate-pulse" />
        ) : chartData.length < 2 ? (
          <div className="h-44 flex flex-col justify-center text-center">
            <p className="text-sm font-medium text-foreground">Ainda não há histórico suficiente</p>
            <p className="text-xs text-muted-foreground mt-1">
              Registre dados em pelo menos dois períodos para acompanhar se cada unidade está fechando o gap.
            </p>
          </div>
        ) : chartUnits.length === 0 ? (
          <div className="h-44 flex flex-col justify-center text-center">
            <p className="text-sm font-medium text-foreground">Sem gaps calculáveis para este indicador</p>
            <p className="text-xs text-muted-foreground mt-1">Verifique se as unidades possuem os dados necessários em cada período.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {benchmarkBaseChanges.length > 0 && (
              <div
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <p className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  A base do Padrão Ouro mudou durante o histórico
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  A comparação pode variar porque o número de unidades que contribuem para o benchmark mudou
                  {benchmarkBaseChanges.map(change => (
                    <span key={change.period}>
                      {" "}em {change.period} ({change.previousCount} → {change.currentCount} unidade{change.currentCount !== 1 ? "s" : ""})
                    </span>
                  ))}
                  . Considere essa mudança ao interpretar a evolução.
                </p>
              </div>
            )}
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    domain={["auto", 0]}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value: number) => `${value.toFixed(0)}%`}
                  />
                  <Tooltip
                    formatter={value => {
                      const numericValue = Array.isArray(value) ? value[0] : value;
                      return numericValue == null ? "—" : `${Number(numericValue).toFixed(1)}% abaixo do ouro`;
                    }}
                    labelFormatter={label => `Período: ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                  <ReferenceLine y={0} stroke="#d97706" strokeDasharray="4 4" label={{ value: "Padrão Ouro", position: "insideTopRight", fontSize: 11 }} />
                  {chartUnits.map((unit, index) => (
                    <Line
                      key={unit.companyId}
                      type="monotone"
                      dataKey={`unit-${unit.companyId}`}
                      name={unit.companyName}
                      stroke={lineColors[index % lineColors.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Narrative text renderer ────────────────────────────────────────────── */
function NarrativeText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed text-foreground">
      {lines.map((line, i) => {
        if (/^\*\*[^*]+\*\*$/.test(line.trim()))
          return <p key={i} className="font-semibold text-foreground mt-4 first:mt-0">{line.trim().replace(/\*\*/g, "")}</p>;
        if (line.includes("**")) {
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={i} className={line.trim() === "" ? "mt-2" : ""}>
              {parts.map((p, j) => /^\*\*[^*]+\*\*$/.test(p)
                ? <strong key={j}>{p.replace(/\*\*/g, "")}</strong> : p)}
            </p>
          );
        }
        if (line.trim().startsWith("- ")) return <p key={i} className="pl-4"><span className="text-muted-foreground mr-1">•</span>{line.trim().slice(2)}</p>;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */
export default function NetworkDiagnosisPanel({ networkId, networkName }: { networkId: number; networkName: string }) {
  const [periods, setPeriods]     = useState<{ period: string; unitCount: number }[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [periodsLoaded, setPeriodsLoaded]   = useState(false);

  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [ranking, setRanking]   = useState<RankingData | null>(null);
  const [loadingRank, setLoadingRank] = useState(false);
  const [rankError, setRankError]     = useState<string | null>(null);
  const [gapHistory, setGapHistory] = useState<GapHistoryData | null>(null);
  const [gapHistoryError, setGapHistoryError] = useState<string | null>(null);
  const [selectedGapMetric, setSelectedGapMetric] = useState("mcPct");

  const [aiText, setAiText]       = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]     = useState<string | null>(null);
  const [aiHasRun, setAiHasRun]   = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Lazy-load periods on first render of this panel
  const loadPeriods = async () => {
    if (periodsLoaded) return;
    setLoadingPeriods(true);
    try {
      const r = await fetch(`/api/networks/${networkId}/periods`, { credentials: "include" });
      const data = await r.json();
      setPeriods(data);
      if (data.length > 0) setSelectedPeriod(data[0].period);
    } catch { /* silent */ }
    finally { setLoadingPeriods(false); setPeriodsLoaded(true); }
  };

  // Call on mount (useEffect equivalent via callback ref trick — use a ref flag instead)
  const mountedRef = useRef(false);
  if (!mountedRef.current) { mountedRef.current = true; loadPeriods(); }

  const loadRanking = async () => {
    if (!selectedPeriod) return;
    setLoadingRank(true); setRankError(null); setRanking(null); setGapHistory(null); setGapHistoryError(null);
    setAiText(""); setAiHasRun(false);
    try {
      const [rankingResult, historyResult] = await Promise.allSettled([
        fetch(`/api/networks/${networkId}/ranking?period=${encodeURIComponent(selectedPeriod)}`, { credentials: "include" }),
        fetch(`/api/networks/${networkId}/gap-history`, { credentials: "include" }),
      ]);

      if (rankingResult.status === "rejected") {
        setRankError("Não foi possível carregar o diagnóstico do período.");
      } else if (!rankingResult.value.ok) {
        setRankError(`Erro ${rankingResult.value.status}`);
      } else {
        try {
          setRanking(await rankingResult.value.json());
        } catch {
          setRankError("Não foi possível ler o diagnóstico retornado pelo servidor.");
        }
      }

      if (historyResult.status === "rejected") {
        setGapHistoryError("Não foi possível carregar a evolução dos gaps.");
      } else if (!historyResult.value.ok) {
        setGapHistoryError(`Não foi possível carregar a evolução dos gaps (erro ${historyResult.value.status}).`);
      } else {
        try {
          setGapHistory(await historyResult.value.json());
        } catch {
          setGapHistoryError("Não foi possível ler a evolução dos gaps retornada pelo servidor.");
        }
      }
    } catch (e: any) { setRankError(e.message); }
    finally { setLoadingRank(false); }
  };

  const runAiAnalysis = async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setAiLoading(true); setAiError(null); setAiText(""); setAiHasRun(true);
    try {
      const r = await fetch(`/api/networks/${networkId}/diagnosis-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ period: selectedPeriod }),
        signal: abortRef.current.signal,
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? `Erro ${r.status}`); }
      const reader = r.body!.getReader(); const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "text") setAiText(t => t + evt.text);
            else if (evt.type === "error") setAiError(evt.error);
          } catch {}
        }
      }
    } catch (e: any) { if (e.name !== "AbortError") setAiError(e.message ?? "Erro desconhecido"); }
    finally { setAiLoading(false); }
  };

  function handlePrint() { window.print(); }

  function handleDownloadPdf() {
    if (!ranking) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const mL = 20, mR = 20, pageW = 210, cW = pageW - mL - mR;
    let y = 20;
    const checkPage = (need = 8) => { if (y + need > 280) { doc.addPage(); y = 20; } };
    const rule = () => { checkPage(4); doc.setDrawColor(220, 220, 220); doc.line(mL, y, pageW - mR, y); y += 4; };

    // Header
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(30, 30, 30);
    doc.text("Diagnóstico de Rede", mL, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(80, 80, 80);
    doc.text(networkName, mL, y); y += 5;
    doc.text(`Período: ${ranking.period}  |  ${ranking.unitsWithData} unidade${ranking.unitsWithData !== 1 ? "s" : ""} com dados`, mL, y); y += 5;
    doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`, mL, y); y += 5;
    rule();

    // Gold standard
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30, 30, 30);
    doc.text("Padrão Ouro por Dimensão", mL, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
    for (const def of (ranking.metricDefs ?? [])) {
      const g = ranking.goldStandard[def.key];
      if (!g) continue;
      checkPage(5);
      const val = def.key.includes("Pct") || def.key.includes("churn") || def.key.includes("mc") || def.key.includes("ebit") || def.key.includes("net")
        ? `${g.value.toFixed(1)}%` : def.key === "averageTicket" ? brl(g.value) : g.value.toFixed(0);
      doc.text(`${def.label}: ${val} → ${g.companyName}`, mL + 3, y); y += 5;
    }
    y += 2; rule();

    // Unit table (simplified)
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30, 30, 30);
    doc.text("Ranking por Unidade", mL, y); y += 6;
    for (const u of ranking.units.filter(u => u.hasData).sort((a, b) => a.rank - b.rank)) {
      checkPage(20);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
      doc.text(`${u.rank}. ${u.companyName}`, mL, y); y += 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80);
      const m = u.metrics;
      if (m) {
        const items = [
          `Receita Líquida: ${brl(m.netRevenue)}`, `MC: ${pct(m.mcPct)}`,
          `Mg. Operacional: ${pct(m.ebitPct)}`, `Mg. Líquida: ${pct(m.netProfitPct)}`,
          `Ciclo de Caixa: ${m.cashCycle != null ? m.cashCycle + " dias" : "—"}`,
          `NPS: ${m.nps != null ? m.nps : "—"}`, `Churn: ${pct(m.churnPct)}`,
        ].filter(Boolean).join("   ");
        for (const wl of doc.splitTextToSize(items, cW - 4)) { checkPage(4); doc.text(wl, mL + 3, y); y += 4; }
      }
      y += 2;
    }
    rule();

    // AI narrative
    if (aiText) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30, 30, 30);
      doc.text("Análise por Inteligência Artificial", mL, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40);
      for (const raw of aiText.split("\n")) {
        checkPage(6);
        const line = raw.trimEnd();
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          y += 2; checkPage(7);
          doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
          doc.text(line.trim().replace(/\*\*/g, ""), mL, y); y += 5;
          doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); continue;
        }
        if (line.trim() === "") { y += 2; continue; }
        const clean = line.replace(/\*\*/g, "");
        const isBullet = clean.trim().startsWith("- ");
        const ix = isBullet ? mL + 4 : mL;
        const txt = isBullet ? `• ${clean.trim().slice(2)}` : clean;
        for (const wl of doc.splitTextToSize(txt, cW - (isBullet ? 4 : 0))) { checkPage(5); doc.text(wl, ix, y); y += 5; }
      }
    }

    // Footer
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(160, 160, 160);
      doc.text("GESAIA — Diagnóstico de Rede", mL, 290);
      doc.text(`Página ${p} de ${total}`, pageW - mR, 290, { align: "right" });
    }
    const safe = networkName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    doc.save(`diagnostico_rede_${safe}_${selectedPeriod}.pdf`);
  }

  /* ── UI ─────────────────────────────────────────────────────────────────── */
  const withDataUnits = ranking?.units.filter(u => u.hasData) ?? [];
  const topUnit = withDataUnits.find(u => u.rank === 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          Diagnóstico de Rede
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Compara todas as unidades em um período, identifica o <strong>Padrão Ouro</strong> por dimensão
          e mostra o gap de cada unidade em relação ao melhor da rede.
        </p>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3 flex-wrap no-print">
        {loadingPeriods ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />Carregando períodos…
          </div>
        ) : periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum período com dados encontrado.</p>
        ) : (
          <>
            <select
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)}
            >
              {periods.map(p => (
                <option key={p.period} value={p.period}>
                  {p.period} — {p.unitCount} unidade{p.unitCount !== 1 ? "s" : ""}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={loadRanking} disabled={!selectedPeriod || loadingRank}>
              {loadingRank ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
              Analisar período
            </Button>
          </>
        )}
      </div>

      {/* Loading / error */}
      {loadingRank && (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      )}
      {rankError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />{rankError}
          </CardContent>
        </Card>
      )}

      {/* Warning: < 2 units */}
      {ranking && ranking.unitsWithData < 2 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex gap-2 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Apenas {ranking.unitsWithData} unidade tem dados para {ranking.period}. São necessárias pelo menos 2 para gerar o diagnóstico.
          </CardContent>
        </Card>
      )}

      {(loadingRank || gapHistory || gapHistoryError) && (
        <GapHistoryChart
          history={gapHistory}
          error={gapHistoryError}
          selectedMetric={selectedGapMetric}
          onMetricChange={setSelectedGapMetric}
        />
      )}

      {ranking && ranking.unitsWithData >= 2 && (
        <>
          {/* Summary banner */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <Trophy className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {ranking.unitsWithData} de {ranking.unitCount} unidades com dados em {ranking.period}
                  {topUnit && <> · Receita líder: <strong>{topUnit.companyName}</strong> ({brl(topUnit.metrics?.netRevenue)})</>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  O Padrão Ouro representa o melhor valor já alcançado por uma unidade da rede em cada dimensão.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Gold standard cards */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500" />Padrão Ouro por Dimensão
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {(ranking.metricDefs ?? []).map(def => {
                const g = ranking.goldStandard[def.key];
                if (!g) return null;
                const val = def.key === "averageTicket" ? brl(g.value)
                  : def.key === "cashCycle" || def.key === "nps" ? `${Math.round(g.value)}${def.key === "cashCycle" ? " d" : " pts"}`
                  : pct(g.value);
                return (
                  <Card key={def.key} className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/10">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{def.label}</p>
                      <p className="text-base font-bold text-amber-700 dark:text-amber-400 mt-0.5">{val}</p>
                      <p className="text-xs text-muted-foreground/80 mt-1 truncate" title={g.companyName}>{g.companyName}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Ranking table */}
          <Card>
            <CardContent className="pt-4 pb-2 overflow-x-auto">
              <p className="text-sm font-semibold text-foreground mb-3">Ranking das Unidades</p>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-8">#</th>
                    <th className="pb-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unidade</th>
                    {(ranking.metricDefs ?? []).slice(0, 5).map(def => (
                      <th key={def.key} className="pb-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 min-w-[80px]">{def.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withDataUnits.sort((a, b) => a.rank - b.rank).map(unit => (
                    <tr key={unit.companyId} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="py-2.5 text-muted-foreground font-mono text-xs">{unit.rank}</td>
                      <td className="py-2.5 font-medium text-foreground">{unit.companyName}</td>
                      {(ranking.metricDefs ?? []).slice(0, 5).map(def => {
                        const v = unit.metrics?.[def.key];
                        const gap = unit.gaps?.[def.key] ?? null;
                        const isGold = ranking.goldStandard[def.key]?.companyId === unit.companyId;
                        return (
                          <td key={def.key} className="py-2.5 text-right px-2">
                            <div className="text-xs font-medium text-foreground">{fmtMetric(def, v)}</div>
                            <GapBadge gap={gap} isGold={isGold} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {ranking.units.filter(u => !u.hasData).map(unit => (
                    <tr key={unit.companyId} className="border-b border-border/20 opacity-40">
                      <td className="py-2 text-muted-foreground">—</td>
                      <td className="py-2 text-muted-foreground italic">{unit.companyName}</td>
                      <td colSpan={5} className="py-2 text-xs text-muted-foreground">sem dados para este período</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Fichas individuais por unidade */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />Ficha por Unidade
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Gap de cada unidade em relação ao Padrão Ouro — use nas reuniões individuais com cada franqueado.
            </p>
            <div className="space-y-2">
              {withDataUnits.sort((a, b) => a.rank - b.rank).map(unit => (
                <UnitSheet key={unit.companyId} unit={unit} ranking={ranking} />
              ))}
            </div>
          </div>

          {/* AI section */}
          <div className="border-t border-border pt-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap no-print">
              <div>
                <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Brain className="w-4 h-4 text-primary" />Análise por IA
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Narrativa completa da saúde da rede, destaques, alertas e recomendações.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {aiHasRun && !aiLoading && aiText && (
                  <>
                    <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
                      <Download className="w-4 h-4 mr-2" />PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint}>
                      <Printer className="w-4 h-4 mr-2" />Imprimir
                    </Button>
                  </>
                )}
                <Button size="sm" onClick={runAiAnalysis} disabled={aiLoading} variant={aiHasRun ? "outline" : "default"}>
                  {aiLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisando…</>
                    : aiHasRun
                      ? <><Brain className="w-4 h-4 mr-2" />Refazer</>
                      : <><Brain className="w-4 h-4 mr-2" />Analisar com IA</>}
                </Button>
              </div>
            </div>

            {/* Print-only header */}
            <div className="print-only hidden">
              <h2 className="text-xl font-bold">Diagnóstico de Rede — GESAIA</h2>
              <p className="text-sm text-gray-600 mt-1">{networkName}</p>
              <p className="text-xs text-gray-400 mt-1">
                Período: {ranking.period} · {ranking.unitsWithData} unidades analisadas ·{" "}
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
                  {aiText ? <NarrativeText text={aiText} /> : (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />Gerando análise da rede…
                    </div>
                  )}
                  {aiLoading && aiText && <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 rounded-sm align-middle" />}
                </CardContent>
              </Card>
            )}

            {!aiHasRun && (
              <Card className="border-dashed">
                <CardContent className="p-8 flex flex-col items-center gap-2 text-center">
                  <Brain className="w-8 h-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Clique em <strong>Analisar com IA</strong> para receber o diagnóstico completo da rede
                    com destaques, alertas e recomendações baseados nos dados reais.
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
