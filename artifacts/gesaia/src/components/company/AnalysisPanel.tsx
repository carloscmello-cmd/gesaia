import React, { useState, useEffect, useRef } from "react";
import {
  derivePeriodOptions,
  deriveEffectivePeriod,
  syncPeriodFromHistoryRun,
} from "./analysisPeriodSync.ts";
import {
  cancelSpotCheckRequest,
  matchesSpotCheckBaseline,
  ownsSpotCheckRequest,
  shouldApplySpotCheckResponse,
  type SpotCheckRequest,
} from "./spotCheckGuard.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useRunFullAnalysis,
  listCalculationHistory,
  listPeriods,
  getListPeriodsQueryKey,
} from "@workspace/api-client-react";
import type { FullAnalysisResult, AnalysisFinding } from "@workspace/api-client-react";
import {
  Brain, Play, Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Activity, ShoppingCart, Megaphone, Settings, Users, Shield, Lightbulb, Globe, Network, Compass,
  ChevronDown, ChevronUp, History, Clock, ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, PieChart, Pie, Cell, ReferenceLine,
  ComposedChart, Area, Legend,
} from "recharts";
import { scoreRingColor, type ScoreThresholds } from "@/lib/scoreThresholds";
import type { DataEntryGroup, DataEntryNavigationTarget } from "./dataEntryNavigation";

/* ── Engine metadata ─────────────────────────────────────────────────── */
const ENGINE_META: Record<string, {
  label: string; icon: React.ElementType; color: string;
  bg: string; border: string;
  highlights: string[];
}> = {
  financial: {
    label: "Financeiro", icon: TrendingUp, color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-800",
    highlights: ["contributionMarginPct", "ebitdaMargin", "safetyMargin", "cashCycle"],
  },
  commercial: {
    label: "Comercial", icon: ShoppingCart, color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800",
    highlights: ["cac", "estimatedLTV", "ltvCacRatio", "conversionRate"],
  },
  marketing: {
    label: "Marketing & NPS", icon: Megaphone, color: "text-violet-600",
    bg: "bg-violet-50 dark:bg-violet-950/20", border: "border-violet-200 dark:border-violet-800",
    highlights: ["nps", "npsClassification", "ctr", "roas"],
  },
  operations: {
    label: "Operações", icon: Settings, color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-950/20", border: "border-orange-200 dark:border-orange-800",
    highlights: ["oeeIndex", "oeeClassification", "capacityUtilization", "capacitySlack"],
  },
  hr: {
    label: "RH", icon: Users, color: "text-pink-600",
    bg: "bg-pink-50 dark:bg-pink-950/20", border: "border-pink-200 dark:border-pink-800",
    highlights: ["retentionRate", "turnoverRate", "turnoverCostEstimate", "trainingRoi"],
  },
  risks: {
    label: "Riscos", icon: Shield, color: "text-red-600",
    bg: "bg-red-50 dark:bg-red-950/20", border: "border-red-200 dark:border-red-800",
    highlights: ["riskLevel", "overallExposure", "defaultRisk", "leverageRisk"],
  },
  innovation: {
    label: "Inovação", icon: Lightbulb, color: "text-yellow-600",
    bg: "bg-yellow-50 dark:bg-yellow-950/20", border: "border-yellow-200 dark:border-yellow-800",
    highlights: ["manualCostAnnual", "automationRoi", "paybackMonths", "errorRatePct"],
  },
  market_intelligence: {
    label: "Inteligência de Mercado", icon: Globe, color: "text-teal-600",
    bg: "bg-teal-50 dark:bg-teal-950/20", border: "border-teal-200 dark:border-teal-800",
    highlights: ["marketShare", "growthGap", "growthPosition", "companyGrowth"],
  },
  network: {
    label: "Rede", icon: Network, color: "text-indigo-600",
    bg: "bg-indigo-50 dark:bg-indigo-950/20", border: "border-indigo-200 dark:border-indigo-800",
    highlights: ["networkEfficiencyIndex", "networkRank", "gapToIdealModel", "totalNetworkUnits"],
  },
  strategy: {
    label: "Estratégia", icon: Compass, color: "text-cyan-600",
    bg: "bg-cyan-50 dark:bg-cyan-950/20", border: "border-cyan-200 dark:border-cyan-800",
    highlights: ["growthClassification", "portfolioConcentrationRisk", "competitivePosition", "maturityClassification"],
  },
};

const IMPACT_CONFIG = {
  high:   { label: "Alta Prioridade",  variant: "destructive" as const, icon: AlertTriangle, ringBg: "bg-red-50 dark:bg-red-950/30",    ringBorder: "border-red-200 dark:border-red-800" },
  medium: { label: "Média Prioridade", variant: "secondary"  as const, icon: TrendingDown,  ringBg: "bg-yellow-50 dark:bg-yellow-950/20", ringBorder: "border-yellow-300 dark:border-yellow-700" },
  low:    { label: "Boa Performance",  variant: "default"    as const, icon: CheckCircle2,  ringBg: "bg-emerald-50 dark:bg-emerald-950/20", ringBorder: "border-emerald-200 dark:border-emerald-700" },
};

/* ── Metric formatter ────────────────────────────────────────────────── */
const PCT_KEYS = new Set([
  "grossMargin","ebitdaMargin","netMargin","operatingMargin","costRevRatio",
  "contributionMarginPct","safetyMargin","capacityUtilization","oeeIndex","defectRate",
  "operatingLeverage","topClientConcentration","marketShare","companyGrowth","marketGrowth",
  "retentionRate","turnoverRate",
  "revenueGrowthPct","topProductConcentrationPct","newMarketsRevenuePct",
  "ctr","roiMarketing","capacitySlack","qualityRate",
]);
const BRL_KEYS = new Set([
  "averageTicket","revenuePerEmployee","contributionMargin","breakEvenRevenue","operatingResult",
  "workingCapitalNeed","maxProLabore","currentProLabore","estimatedMRR","estimatedLTV",
  "revenuePerCustomer","cac","ltv","manualCostMonthly","manualCostAnnual","automationInvestment",
  "turnoverCostEstimate","turnoverCostTotal","trainingInvestment","marketSize",
  "cpl","totalExpectedLoss","expectedDefaultLoss","totalAcquisitionCost","avgSalary",
]);
const DAY_KEYS  = new Set(["operatingCycle","cashCycle","paybackMonths","avgCycleTimeMins","trainingPaybackMonths"]);

function formatMetric(key: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  const n = Number(val);
  if (!isNaN(n)) {
    if (PCT_KEYS.has(key))  return `${n.toFixed(1)}%`;
    if (BRL_KEYS.has(key))  return `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
    if (DAY_KEYS.has(key))  return (key === "paybackMonths" || key === "trainingPaybackMonths") ? `${Math.round(n)} meses` : `${Math.round(n)} dias`;
    if (key === "ltvCacRatio") return `${n.toFixed(1)}×`;
    if (key === "automationRoi" || key === "roas" || key === "trainingRoi" || key === "trainingRoiEstimate") return `${n.toFixed(1)}×`;
    if (key === "growthGap") return `${n > 0 ? "+" : ""}${n.toFixed(1)}pp`;
    if (key === "networkRank") return `#${Math.round(n)}`;
    return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  }
  return String(val);
}

const METRIC_LABELS: Record<string, string> = {
  // Financial
  grossMargin: "Margem Bruta", ebitdaMargin: "EBITDA", netMargin: "Margem Líquida",
  operatingMargin: "Margem Operacional", costRevRatio: "Custo/Receita",
  contributionMargin: "Margem de Contribuição", contributionMarginPct: "Margem de Contribuição",
  breakEvenRevenue: "Ponto de Equilíbrio", safetyMargin: "Margem de Segurança",
  safetyMarginClass: "Margem de Segurança", operatingResult: "Resultado Operacional",
  operatingCycle: "Ciclo Operacional", cashCycle: "Ciclo de Caixa",
  workingCapitalNeed: "Capital de Giro Necessário",
  maxProLabore: "Pró-labore Máximo", currentProLabore: "Pró-labore Atual",
  markupOnCogs: "Markup sobre CMV",
  // Commercial
  conversionRate: "Taxa de Conversão", averageTicket: "Ticket Médio",
  churnRate: "Churn", activeCustomers: "Clientes Ativos",
  estimatedLTV: "LTV Estimado", estimatedMRR: "MRR Estimado",
  revenuePerCustomer: "Receita/Cliente", totalAcquisitionCost: "Custo Total de Aquisição",
  // Marketing
  nps: "NPS", npsClassification: "Classificação NPS",
  cac: "CAC", ltv: "LTV", ltvCacRatio: "LTV/CAC", ltvCacClassification: "LTV/CAC Status",
  ctr: "CTR", ctrClassification: "Qualidade CTR",
  cpl: "CPL", roas: "ROAS", roasClassification: "Qualidade ROAS",
  roiMarketing: "ROI Marketing", roiClassification: "Qualidade ROI",
  // Operations
  totalEmployees: "Colaboradores", revenuePerEmployee: "Receita/Colaborador",
  capacityUtilization: "Utilização da Capacidade", capacitySlack: "Folga de Capacidade",
  oeeIndex: "OEE", oeeClassification: "OEE Status", utilizationClassification: "Status Utilização",
  defectRate: "Taxa de Defeito", avgCycleTimeMins: "Tempo de Ciclo",
  bottleneckStage: "Gargalo Detectado", qualityRate: "Taxa de Qualidade",
  // HR
  retentionRate: "Taxa de Retenção", turnoverRate: "Turnover",
  turnoverCostEstimate: "Custo do Turnover", turnoverCostTotal: "Custo Total Turnover",
  trainingInvestment: "Investimento em Treinamento", avgSalary: "Salário Médio",
  trainingHoursPerYear: "Horas de Treinamento/Ano", newHires: "Novas Contratações",
  trainingRoiEstimate: "ROI de Treinamento", trainingRoi: "ROI de Treinamento",
  trainingRoiClassification: "ROI Treinamento Status", trainingPaybackMonths: "Payback Treinamento",
  // Risks
  defaultRate: "Inadimplência", defaultRisk: "Risco de Inadimplência",
  expectedDefaultLoss: "Perda Esperada (Inadimplência)",
  operatingLeverage: "Alavancagem Operacional", leverageRisk: "Risco de Alavancagem",
  topClientConcentration: "Concentração Top Cliente", concentrationRisk: "Risco de Concentração",
  riskLevel: "Nível de Risco", overallExposure: "Exposição Geral",
  totalExpectedLoss: "Perda Esperada Total",
  // Innovation
  manualProcessHours: "Horas Processo Manual/mês", operatorHourlyCost: "Custo/hora Operador",
  manualCostMonthly: "Custo Manual/mês", manualCostAnnual: "Custo Manual/ano",
  automationInvestment: "Investimento Automação", automationRoi: "ROI Automação",
  paybackMonths: "Payback", errorRatePct: "Taxa de Erro",
  // Market Intelligence
  marketShare: "Market Share", marketSize: "Tamanho do Mercado",
  marketGrowth: "Crescimento do Mercado", companyGrowth: "Crescimento da Empresa",
  growthGap: "Gap vs Mercado", growthPosition: "Posição vs Mercado",
  benchmarkGrossMargin: "Margem Bruta Benchmark", benchmarkConversion: "Conversão Benchmark",
  // Network
  networkEfficiencyIndex: "Índice de Eficiência", networkRank: "Posição no Ranking",
  gapToIdealModel: "Gap ao Modelo Ideal", totalNetworkUnits: "Unidades na Rede",
  // Strategy
  revenueGrowthPct: "Crescimento de Receita", growthClassification: "Classificação de Crescimento",
  topProductConcentrationPct: "Concentração do Produto Principal", portfolioConcentrationRisk: "Risco de Concentração",
  newMarketsRevenuePct: "Receita de Novos Mercados %", innovationShareClassification: "Nível de Inovação",
  competitivePosition: "Posição Competitiva (1–10)", businessAgeYears: "Anos em Operação",
  maturityClassification: "Estágio de Maturidade",
};

const SKIP_METRIC_KEYS = new Set([
  "score","status","message","note","churnRate",
  // classification strings already shown as badges in chart sections
  "ctrClassification","roasClassification","roiClassification","ltvCacClassification",
  "oeeClassification","utilizationClassification","qualityClassification",
  "turnoverClassification","trainingRoiClassification",
  "defaultRisk","leverageRisk","concentrationRisk",
  // complex objects rendered in charts
  "riskMatrix",
  // redundant aliases
  "trainingRoiEstimate","turnoverCostTotal",
]);

/* ── Custom tooltip for charts ───────────────────────────────────────── */
function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-md">
      {label && <p className="font-semibold text-foreground mb-1">{label}</p>}
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="text-xs">
          {entry.name}: {formatter ? formatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
}

/* ── Missing data guidance ───────────────────────────────────────────── */
type DataEntryField = { key: string; label: string };

function DataEntryPrompt({
  fields,
  group,
  onNavigateToData,
}: {
  fields: DataEntryField[];
  group: DataEntryGroup;
  onNavigateToData?: (target: Omit<DataEntryNavigationTarget, "period">) => void;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/20">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-amber-900 dark:text-amber-300">
          Complete os dados para liberar mais indicadores
        </p>
        <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
          Preencha na aba Dados:
        </p>
        <ul className="mt-1 list-inside list-disc text-xs text-amber-800 dark:text-amber-300">
          {fields.map(field => <li key={field.key}>{field.label}</li>)}
        </ul>
        {onNavigateToData && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-1 h-auto px-0 py-0 text-xs text-amber-800 dark:text-amber-300"
            onClick={() => onNavigateToData({ group, fields: fields.map((field) => field.key) })}
          >
            Ir para Dados <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Safety-margin badge ─────────────────────────────────────────────── */
const SAFETY_MARGIN_CLASS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  "Péssimo":   { label: "Péssimo",   bg: "bg-red-100 dark:bg-red-950/40",       text: "text-red-700 dark:text-red-400" },
  "Ruim":      { label: "Ruim",      bg: "bg-orange-100 dark:bg-orange-950/40", text: "text-orange-700 dark:text-orange-400" },
  "Aceitável": { label: "Aceitável", bg: "bg-yellow-100 dark:bg-yellow-950/40", text: "text-yellow-700 dark:text-yellow-400" },
  "Bom":       { label: "Bom",       bg: "bg-blue-100 dark:bg-blue-950/40",     text: "text-blue-700 dark:text-blue-400" },
  "Excelente": { label: "Excelente", bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400" },
};

function SafetyMarginBadge({ value }: { value: string }) {
  const cfg = SAFETY_MARGIN_CLASS_CONFIG[value];
  if (!cfg) return <span className="text-xs text-muted-foreground">{value}</span>;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

/* ── Engine-specific charts ──────────────────────────────────────────── */
function FinancialChart({ metrics }: { metrics: Record<string, unknown> }) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };

  // Margin bars (traditional + new)
  const marginData = [
    { name: "Margem Bruta", value: n("grossMargin"), fill: "#3b82f6" },
    { name: "EBITDA",       value: n("ebitdaMargin"), fill: "#8b5cf6" },
    { name: "Margem Líq.",  value: n("netMargin"), fill: "#06b6d4" },
    { name: "MC%",          value: n("contributionMarginPct"), fill: "#10b981" },
    { name: "Segurança",    value: n("safetyMargin"), fill: "#f59e0b" },
  ].filter(d => d.value !== null) as { name: string; value: number; fill: string }[];

  const mc         = n("contributionMargin");
  const mcPct      = n("contributionMarginPct");
  const breakEven  = n("breakEvenRevenue");
  const safety     = n("safetyMargin");
  const safetyClass = metrics["safetyMarginClass"] as string | undefined;
  const cashCycle  = n("cashCycle");

  const hasNewIndicators = mc !== null || breakEven !== null || safety !== null || cashCycle !== null;

  if (marginData.length === 0 && !hasNewIndicators) return null;

  return (
    <div className="mt-3 space-y-3">
      {/* New financial indicators — 4-card grid */}
      {hasNewIndicators && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Novos Indicadores Financeiros</p>
          <div className="grid grid-cols-2 gap-2">
            {/* Margem de Contribuição */}
            {(mc !== null || mcPct !== null) && (
              <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                <p className="text-xs text-muted-foreground">Margem de Contribuição</p>
                {mc !== null && (
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    R$ {Math.round(mc).toLocaleString("pt-BR")}
                  </p>
                )}
                {mcPct !== null && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-500">{mcPct.toFixed(1)}% da receita</p>
                )}
              </div>
            )}
            {/* Ponto de Equilíbrio */}
            {breakEven !== null && (
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-muted-foreground">Ponto de Equilíbrio</p>
                <p className="text-sm font-bold text-blue-700 dark:text-blue-400">
                  R$ {Math.round(breakEven).toLocaleString("pt-BR")}
                </p>
              </div>
            )}
            {/* Margem de Segurança */}
            {safety !== null && (
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-muted-foreground">Margem de Segurança</p>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{safety.toFixed(1)}%</p>
                {safetyClass && (
                  <div className="mt-1">
                    <SafetyMarginBadge value={safetyClass} />
                  </div>
                )}
              </div>
            )}
            {/* Ciclo de Caixa */}
            {cashCycle !== null && (
              <div className="bg-violet-50 dark:bg-violet-950/20 rounded-lg px-3 py-2 border border-violet-200 dark:border-violet-800">
                <p className="text-xs text-muted-foreground">Ciclo de Caixa</p>
                <p className="text-sm font-bold text-violet-700 dark:text-violet-400">{Math.round(cashCycle)} dias</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Margin bars chart */}
      {marginData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">Margens (%)</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={marginData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="value" name="Margem" radius={[3, 3, 0, 0]}>
                {marginData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function CommercialChart({
  metrics,
  onNavigateToData,
}: {
  metrics: Record<string, unknown>;
  onNavigateToData?: (target: Omit<DataEntryNavigationTarget, "period">) => void;
}) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const convRate = n("conversionRate");
  const churnRate = n("churnRate");
  const cacVal = n("cac");
  const ltvVal = n("estimatedLTV");
  const ltvCac = n("ltvCacRatio");
  const mrrVal = n("estimatedMRR");

  // ── CAC / LTV / LTV/CAC cards ────────────────────────────────────────
  const hasAcquisition = cacVal !== null || ltvVal !== null || ltvCac !== null;
  const ltvCacClass = ltvCac !== null
    ? (ltvCac >= 3 ? { label: "Saudável", bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300" }
      : ltvCac >= 1.5 ? { label: "Aceitável", bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-300" }
      : { label: "Crítico", bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300" })
    : null;

  const hasBarData = convRate !== null || churnRate !== null;
  const missingAcquisitionFields: DataEntryField[] = [];
  if (cacVal === null) {
    if (n("totalAcquisitionCost") === null) {
      missingAcquisitionFields.push({ key: "totalAcquisitionCost", label: "Custo total de aquisição (totalAcquisitionCost)" });
    }
    if (n("newCustomers") === null) {
      missingAcquisitionFields.push({ key: "newCustomers", label: "Novos clientes (newCustomers)" });
    }
  }
  if (ltvVal === null) {
    if (n("averageTicket") === null) {
      missingAcquisitionFields.push({ key: "averageTicket", label: "Ticket médio (averageTicket)" });
    }
    if (n("churnRate") === null) {
      missingAcquisitionFields.push({ key: "churnRate", label: "Taxa de churn (churnRate)" });
    }
  }
  const barData = [
    convRate !== null && { name: "Conversão", value: Number(convRate.toFixed(2)), fill: "#10b981" },
    churnRate !== null && { name: "Churn Mensal", value: Number(churnRate.toFixed(2)), fill: "#ef4444" },
  ].filter(Boolean) as { name: string; value: number; fill: string }[];

  if (!hasAcquisition && !hasBarData && missingAcquisitionFields.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {/* CAC / LTV / LTV-CAC cards */}
      {hasAcquisition && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Aquisição de Clientes</p>
          <div className="grid grid-cols-3 gap-2">
            {cacVal !== null && (
              <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                <p className="text-xs text-muted-foreground">CAC</p>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">R$ {Math.round(cacVal).toLocaleString("pt-BR")}</p>
              </div>
            )}
            {ltvVal !== null && (
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-muted-foreground">LTV</p>
                <p className="text-sm font-bold text-blue-700 dark:text-blue-400">R$ {Math.round(ltvVal).toLocaleString("pt-BR")}</p>
              </div>
            )}
            {ltvCac !== null && ltvCacClass && (
              <div className="bg-background/70 rounded-lg px-3 py-2 border border-border">
                <p className="text-xs text-muted-foreground">LTV/CAC</p>
                <p className="text-sm font-bold text-foreground">{ltvCac.toFixed(1)}×</p>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ltvCacClass.bg} ${ltvCacClass.text}`}>
                  {ltvCacClass.label}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conversion / Churn bars */}
      {hasBarData && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">Taxa de Conversão & Churn (%)</p>
          <ResponsiveContainer width="100%" height={barData.length * 44 + 20}>
            <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={84} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(2)}%`} />} />
              <Bar dataKey="value" name="Valor" radius={[0, 3, 3, 0]}>
                {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {mrrVal !== null && (
        <div className="bg-background/70 rounded-lg px-3 py-2 border border-border">
          <p className="text-xs text-muted-foreground">MRR Estimado</p>
          <p className="text-sm font-bold text-foreground">R$ {mrrVal.toLocaleString("pt-BR")}</p>
        </div>
      )}

      <DataEntryPrompt group="commercial" fields={missingAcquisitionFields} onNavigateToData={onNavigateToData} />
    </div>
  );
}

function MarketingChart({
  metrics,
  onNavigateToData,
}: {
  metrics: Record<string, unknown>;
  onNavigateToData?: (target: Omit<DataEntryNavigationTarget, "period">) => void;
}) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const nps = n("nps");
  const ltvCac = n("ltvCacRatio");
  const ctr = n("ctr");
  const cpl = n("cpl");
  const roas = n("roas");
  const roi = n("roiMarketing");
  const cacVal = n("cac");

  const hasNps = nps !== null;
  const hasPerf = ctr !== null || roas !== null || cpl !== null || roi !== null;
  const hasLtvCac = ltvCac !== null;
  const missingMarketingFields: DataEntryField[] = [];
  const addMissing = (key: string, label: string) => {
    if (metrics[key] == null && !missingMarketingFields.some(field => field.key === key)) {
      missingMarketingFields.push({ key, label });
    }
  };
  if (ctr === null) {
    addMissing("clicks", "Cliques em anúncios (clicks)");
    addMissing("impressions", "Impressões de anúncios (impressions)");
  }
  if (cpl === null) {
    addMissing("adSpend", "Investimento em mídia (adSpend)");
    addMissing("adLeads", "Leads de anúncios (adLeads)");
  }
  if (roas === null || roi === null) {
    addMissing("adSpend", "Investimento em mídia (adSpend)");
    addMissing("adRevenue", "Receita atribuída aos anúncios (adRevenue)");
  }
  if (!hasNps && !hasPerf && !hasLtvCac && missingMarketingFields.length === 0) return null;

  // NPS gauge
  const npsNorm = nps !== null ? Math.max(0, Math.min(100, nps)) : null;
  const npsColor = nps === null ? "#6b7280"
    : nps >= 75 ? "#10b981" : nps >= 50 ? "#3b82f6" : nps >= 0 ? "#f59e0b" : "#ef4444";
  const gaugeData = npsNorm !== null ? [{ name: "NPS", value: npsNorm, fill: npsColor }] : [];

  // Classification badge helper
  function ClassBadge({ value, color }: { value: string; color: "emerald"|"blue"|"yellow"|"red" }) {
    const cls = {
      emerald: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
      blue:    "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
      yellow:  "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
      red:     "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    }[color];
    return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{value}</span>;
  }

  function ctrColor(v: number): "emerald"|"blue"|"yellow"|"red" {
    return v >= 5 ? "emerald" : v >= 2 ? "blue" : v >= 1 ? "yellow" : "red";
  }
  function roasColor(v: number): "emerald"|"blue"|"yellow"|"red" {
    return v >= 4 ? "emerald" : v >= 2 ? "blue" : v >= 1 ? "yellow" : "red";
  }
  function roiColor(v: number): "emerald"|"blue"|"yellow"|"red" {
    return v > 300 ? "emerald" : v > 100 ? "blue" : v > 0 ? "yellow" : "red";
  }

  return (
    <div className="mt-3 space-y-3">
      {/* NPS + LTV/CAC row */}
      {(hasNps || hasLtvCac) && (
        <div className="grid grid-cols-2 gap-3 items-start">
          {npsNorm !== null && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1 text-center">NPS Score</p>
              <div className="relative">
                <ResponsiveContainer width="100%" height={90}>
                  <RadialBarChart innerRadius="55%" outerRadius="80%" startAngle={180} endAngle={0} data={gaugeData}>
                    <RadialBar dataKey="value" background={{ fill: "hsl(var(--muted))" }} cornerRadius={4} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
                  <span className="text-xl font-bold" style={{ color: npsColor }}>{nps}</span>
                  <span className="text-xs text-muted-foreground">{String(metrics.npsClassification ?? "")}</span>
                </div>
              </div>
            </div>
          )}
          {hasLtvCac && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1 text-center">LTV/CAC</p>
              <div className="flex flex-col items-center justify-center h-[90px] gap-1">
                <span className={`text-3xl font-bold ${ltvCac! >= 3 ? "text-emerald-600" : ltvCac! >= 1.5 ? "text-yellow-600" : "text-red-600"}`}>
                  {ltvCac!.toFixed(1)}×
                </span>
                <ClassBadge
                  value={ltvCac! >= 3 ? "Saudável" : ltvCac! >= 1.5 ? "Aceitável" : "Crítico"}
                  color={ltvCac! >= 3 ? "emerald" : ltvCac! >= 1.5 ? "yellow" : "red"}
                />
                {cacVal !== null && (
                  <span className="text-xs text-muted-foreground">CAC: R$ {cacVal.toLocaleString("pt-BR")}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CTR / ROAS / CPL / ROI cards */}
      {hasPerf && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Performance de Mídia</p>
          <div className="grid grid-cols-2 gap-2">
            {ctr !== null && (
              <div className="bg-violet-50 dark:bg-violet-950/20 rounded-lg px-3 py-2 border border-violet-200 dark:border-violet-800">
                <p className="text-xs text-muted-foreground">CTR</p>
                <p className="text-sm font-bold text-violet-700 dark:text-violet-400">{ctr.toFixed(2)}%</p>
                <ClassBadge value={String(metrics.ctrClassification ?? "")} color={ctrColor(ctr)} />
              </div>
            )}
            {roas !== null && (
              <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                <p className="text-xs text-muted-foreground">ROAS</p>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{roas.toFixed(1)}×</p>
                <ClassBadge value={String(metrics.roasClassification ?? "")} color={roasColor(roas)} />
              </div>
            )}
            {cpl !== null && (
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-muted-foreground">CPL</p>
                <p className="text-sm font-bold text-blue-700 dark:text-blue-400">R$ {Math.round(cpl).toLocaleString("pt-BR")}</p>
              </div>
            )}
            {roi !== null && (
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-muted-foreground">ROI Marketing</p>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{roi.toFixed(1)}%</p>
                <ClassBadge value={String(metrics.roiClassification ?? "")} color={roiColor(roi)} />
              </div>
            )}
          </div>
        </div>
      )}

      <DataEntryPrompt group="marketing" fields={missingMarketingFields} onNavigateToData={onNavigateToData} />
    </div>
  );
}

function OperationsChart({
  metrics,
  onNavigateToData,
}: {
  metrics: Record<string, unknown>;
  onNavigateToData?: (target: Omit<DataEntryNavigationTarget, "period">) => void;
}) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const cap = n("capacityUtilization");
  const oee = n("oeeIndex");
  const def = n("defectRate");
  const slack = n("capacitySlack");
  const revPerEmp = n("revenuePerEmployee");
  const bottleneck = metrics.bottleneckStage as string | undefined;
  const oeeClass = metrics.oeeClassification as string | undefined;
  const utilClass = metrics.utilizationClassification as string | undefined;
  const missingOeeFields: DataEntryField[] = [
    { key: "oeeAvailability", label: "Disponibilidade OEE (oeeAvailability)" },
    { key: "oeePerformance", label: "Performance OEE (oeePerformance)" },
    { key: "oeeQuality", label: "Qualidade OEE (oeeQuality)" },
  ].filter(field => metrics[field.key] == null);
  const needsOeePrompt = oee === null && missingOeeFields.length > 0;

  // OEE classification badge colors
  const OEE_CLASS_COLOR: Record<string, string> = {
    "Classe Mundial": "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
    "Bom":            "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    "Aceitável":      "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    "Crítico":        "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  };
  const UTIL_CLASS_COLOR: Record<string, string> = {
    "Saturado": "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    "Bom":      "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
    "Médio":    "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    "Ocioso":   "bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300",
  };

  const hasKpi = oee !== null || cap !== null;
  const barData = [
    cap !== null && { name: "Utilização Cap.", value: Number(cap.toFixed(1)), fill: "#f97316" },
    oee !== null && { name: "OEE", value: Number(oee.toFixed(1)), fill: "#fb923c" },
    def !== null && { name: "Taxa Defeito", value: Number(def.toFixed(1)), fill: "#ef4444" },
  ].filter(Boolean) as { name: string; value: number; fill: string }[];

  if (barData.length === 0 && revPerEmp === null && !bottleneck && !needsOeePrompt) return null;

  return (
    <div className="mt-3 space-y-3">
      {/* OEE + Capacidade KPI cards */}
      {hasKpi && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Indicadores Operacionais</p>
          <div className="grid grid-cols-2 gap-2">
            {oee !== null && (
              <div className="bg-orange-50 dark:bg-orange-950/20 rounded-lg px-3 py-2 border border-orange-200 dark:border-orange-800">
                <p className="text-xs text-muted-foreground">OEE</p>
                <p className="text-sm font-bold text-orange-700 dark:text-orange-400">{oee.toFixed(1)}%</p>
                {oeeClass && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${OEE_CLASS_COLOR[oeeClass] ?? "bg-muted text-muted-foreground"}`}>
                    {oeeClass}
                  </span>
                )}
              </div>
            )}
            {cap !== null && (
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-muted-foreground">Utilização</p>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{cap.toFixed(1)}%</p>
                {slack !== null && <p className="text-xs text-muted-foreground">Folga: {slack.toFixed(1)}%</p>}
                {utilClass && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${UTIL_CLASS_COLOR[utilClass] ?? "bg-muted text-muted-foreground"}`}>
                    {utilClass}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottleneck stage alert */}
      {bottleneck && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Gargalo detectado</p>
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{bottleneck}</p>
          </div>
        </div>
      )}

      {/* Bar chart for all operational indicators */}
      {barData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">Visão Geral (%)</p>
          <ResponsiveContainer width="100%" height={barData.length * 40 + 20}>
            <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
              <Bar dataKey="value" name="Valor" radius={[0, 3, 3, 0]}>
                {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {revPerEmp !== null && (
        <div className="bg-background/70 rounded-lg px-3 py-2 border border-border">
          <p className="text-xs text-muted-foreground">Receita por Colaborador</p>
          <p className="text-sm font-bold text-foreground">R$ {revPerEmp.toLocaleString("pt-BR")}</p>
        </div>
      )}

      {needsOeePrompt && (
        <DataEntryPrompt group="operations" fields={missingOeeFields} onNavigateToData={onNavigateToData} />
      )}
    </div>
  );
}

function HRChart({
  metrics,
  onNavigateToData,
}: {
  metrics: Record<string, unknown>;
  onNavigateToData?: (target: Omit<DataEntryNavigationTarget, "period">) => void;
}) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const retention = n("retentionRate");
  const turnover  = n("turnoverRate");
  const costEst = n("turnoverCostEstimate");
  const revPerEmp = n("revenuePerEmployee");
  const trainingRoi = n("trainingRoi") ?? n("trainingRoiEstimate");
  const trainingPayback = n("trainingPaybackMonths");
  const trainingRoiClass = metrics.trainingRoiClassification as string | undefined;
  const trainingInvestment = n("trainingInvestment");
  const avgSalary = n("avgSalary");
  const trainingHours = n("trainingHoursPerYear");
  const productivityGain = n("productivityGainPct");
  const trainingMissingFields: DataEntryField[] = [];
  if (trainingRoi === null) {
    if (trainingInvestment === null || trainingInvestment <= 0) {
      trainingMissingFields.push({ key: "trainingInvestment", label: "Investimento em treinamento (trainingInvestment)" });
    }
    if (avgSalary === null && metrics.annualSalaryEstimate == null) {
      trainingMissingFields.push({ key: "avgSalary", label: "Salário médio (avgSalary)" });
    }
    if (trainingHours === null && productivityGain === null) {
      trainingMissingFields.push({
        key: "trainingHoursPerYear-or-productivityGainPct",
        label: "Horas de treinamento/ano (trainingHoursPerYear) ou ganho de produtividade (productivityGainPct)",
      });
    }
  }
  const hasTrainingPrompt = trainingRoi === null && trainingMissingFields.length > 0;

  if (retention === null && turnover === null && trainingRoi === null && !hasTrainingPrompt) return null;

  const donutData = [
    { name: "Retenção", value: retention ?? (turnover !== null ? 100 - turnover : 0), fill: "#10b981" },
    { name: "Turnover", value: turnover ?? (retention !== null ? 100 - retention : 0), fill: "#f43f5e" },
  ];

  const ROI_CLASS_COLOR: Record<string, string> = {
    "Excelente": "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
    "Bom":       "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    "Aceitável": "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    "Negativo":  "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  };

  return (
    <div className="mt-3 space-y-3">
      {/* Retention / Turnover donut */}
      {(retention !== null || turnover !== null) && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">Retenção vs Turnover (%)</p>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={110} height={90}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={26} outerRadius={42} dataKey="value" strokeWidth={0}>
                  {donutData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1.5 flex-1">
              {donutData.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="font-semibold text-foreground ml-auto">{d.value.toFixed(1)}%</span>
                </div>
              ))}
              {costEst !== null && (
                <div className="text-xs mt-1 pt-1 border-t border-border">
                  <span className="text-muted-foreground">Custo turnover est.</span>
                  <span className="font-semibold text-red-600 ml-1">R$ {Math.round(costEst).toLocaleString("pt-BR")}</span>
                </div>
              )}
              {revPerEmp !== null && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Receita/colaborador</span>
                  <span className="font-semibold text-foreground ml-1">R$ {revPerEmp.toLocaleString("pt-BR")}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Training ROI card */}
      {trainingRoi !== null && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">ROI de Treinamento</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-pink-50 dark:bg-pink-950/20 rounded-lg px-3 py-2 border border-pink-200 dark:border-pink-800">
              <p className="text-xs text-muted-foreground">ROI Treinamento</p>
              <p className="text-sm font-bold text-pink-700 dark:text-pink-400">{trainingRoi.toFixed(1)}×</p>
              {trainingRoiClass && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ROI_CLASS_COLOR[trainingRoiClass] ?? "bg-muted text-muted-foreground"}`}>
                  {trainingRoiClass}
                </span>
              )}
            </div>
            {trainingPayback !== null && (
              <div className="bg-background/70 rounded-lg px-3 py-2 border border-border">
                <p className="text-xs text-muted-foreground">Payback</p>
                <p className="text-sm font-bold text-foreground">{Math.round(trainingPayback)} meses</p>
              </div>
            )}
          </div>
        </div>
      )}

      {hasTrainingPrompt && (
        <DataEntryPrompt group="hr" fields={trainingMissingFields} onNavigateToData={onNavigateToData} />
      )}
    </div>
  );
}

function RisksChart({ metrics }: { metrics: Record<string, unknown> }) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const defaultRate = n("defaultRate");
  const opLeverage  = n("operatingLeverage");
  const topClient   = n("topClientConcentration");
  const totalLoss   = n("totalExpectedLoss");
  const overallExp  = metrics.overallExposure as string | undefined;

  // Risk matrix from engine result
  const riskMatrix = Array.isArray(metrics.riskMatrix)
    ? (metrics.riskMatrix as Array<{
        name: string;
        probability: number;
        impact: number;
        expectedLoss: number;
        matrixZone: string;
        probabilityLabel: string;
        impactLabel: string;
      }>)
    : [];

  const ZONE_COLOR: Record<string, { bg: string; text: string }> = {
    "Crítico": { bg: "bg-red-100 dark:bg-red-900/30",    text: "text-red-700 dark:text-red-400" },
    "Alto":    { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-400" },
    "Médio":   { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-400" },
    "Baixo":   { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400" },
  };

  const barData = [
    defaultRate !== null && { name: "Inadimplência", value: Number(defaultRate.toFixed(1)), fill: "#ef4444" },
    opLeverage  !== null && { name: "Alavancagem Op.", value: Number(opLeverage.toFixed(1)), fill: "#f97316" },
    topClient   !== null && { name: "Concentração Cli.", value: Number(topClient.toFixed(1)), fill: "#dc2626" },
  ].filter(Boolean) as { name: string; value: number; fill: string }[];

  if (barData.length === 0 && riskMatrix.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {/* Risk matrix table */}
      {riskMatrix.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Matriz Probabilidade × Impacto</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Risco</th>
                  <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">Prob.</th>
                  <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">Zona</th>
                  <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Perda Esp.</th>
                </tr>
              </thead>
              <tbody>
                {riskMatrix.map((r, i) => {
                  const zc = ZONE_COLOR[r.matrixZone] ?? { bg: "bg-muted", text: "text-muted-foreground" };
                  return (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-2 py-1.5 font-medium text-foreground truncate max-w-[100px]">{r.name}</td>
                      <td className="px-2 py-1.5 text-center text-muted-foreground">{r.probability}%</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded-full font-semibold ${zc.bg} ${zc.text}`}>
                          {r.matrixZone}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold text-red-600 dark:text-red-400">
                        R$ {r.expectedLoss.toLocaleString("pt-BR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Totals row */}
          <div className="mt-2 flex items-center justify-between gap-2">
            {totalLoss !== null && (
              <div className="bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-1.5 border border-red-200 dark:border-red-800 flex-1">
                <p className="text-xs text-muted-foreground">Perda Total Esperada</p>
                <p className="text-sm font-bold text-red-700 dark:text-red-400">R$ {Math.round(totalLoss).toLocaleString("pt-BR")}</p>
              </div>
            )}
            {overallExp && (
              <div className={`rounded-lg px-3 py-1.5 border flex-1 ${ZONE_COLOR[overallExp]?.bg ?? "bg-muted"} border-current/20`}>
                <p className="text-xs text-muted-foreground">Exposição Geral</p>
                <p className={`text-sm font-bold ${ZONE_COLOR[overallExp]?.text ?? "text-foreground"}`}>{overallExp}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Risk indicator bars */}
      {barData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">Indicadores de Risco (%)</p>
          <ResponsiveContainer width="100%" height={barData.length * 44 + 20}>
            <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
              <Bar dataKey="value" name="Valor" radius={[0, 3, 3, 0]}>
                {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function InnovationChart({ metrics }: { metrics: Record<string, unknown> }) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const roi = n("automationRoi");
  const payback = n("paybackMonths");
  const costAnnual = n("manualCostAnnual");
  const investment = n("automationInvestment");

  if (roi === null && costAnnual === null) return null;

  const roiColor = roi === null ? "#6b7280" : roi >= 2 ? "#10b981" : roi >= 1 ? "#f59e0b" : "#ef4444";

  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      {roi !== null && (
        <div className="bg-background/70 rounded-lg px-3 py-3 border border-border text-center">
          <p className="text-xs text-muted-foreground mb-1">ROI de Automação</p>
          <p className="text-2xl font-bold" style={{ color: roiColor }}>{roi.toFixed(1)}×</p>
          {payback !== null && <p className="text-xs text-muted-foreground mt-0.5">Payback: {payback} meses</p>}
        </div>
      )}
      {costAnnual !== null && (
        <div className="bg-background/70 rounded-lg px-3 py-3 border border-border text-center">
          <p className="text-xs text-muted-foreground mb-1">Custo Manual/Ano</p>
          <p className="text-lg font-bold text-foreground">R$ {(costAnnual / 1000).toFixed(0)}k</p>
          {investment !== null && <p className="text-xs text-muted-foreground mt-0.5">Investimento: R$ {(investment / 1000).toFixed(0)}k</p>}
        </div>
      )}
    </div>
  );
}

function MarketIntelligenceChart({ metrics }: { metrics: Record<string, unknown> }) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const marketGrowth  = n("marketGrowth");
  const companyGrowth = n("companyGrowth");
  const growthGap     = n("growthGap");
  const marketShare   = n("marketShare");

  const hasGrowthComparison = marketGrowth !== null || companyGrowth !== null;

  if (!hasGrowthComparison && marketShare === null) return null;

  return (
    <div className="mt-3 space-y-3">
      {hasGrowthComparison && (
        <>
          <p className="text-xs text-muted-foreground font-medium">Crescimento: Empresa vs Mercado (%)</p>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart
              data={[{
                name: "Crescimento",
                empresa: companyGrowth ?? 0,
                mercado: marketGrowth ?? 0,
              }]}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="empresa" name="Empresa" fill="#14b8a6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="mercado" name="Mercado" fill="#6b7280" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        {marketShare !== null && (
          <div className="bg-background/70 rounded-lg px-3 py-2 border border-border">
            <p className="text-xs text-muted-foreground">Market Share</p>
            <p className="text-sm font-bold text-foreground">{marketShare.toFixed(2)}%</p>
          </div>
        )}
        {growthGap !== null && (
          <div className="bg-background/70 rounded-lg px-3 py-2 border border-border">
            <p className="text-xs text-muted-foreground">Gap vs Mercado</p>
            <p className={`text-sm font-bold ${growthGap >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {growthGap > 0 ? "+" : ""}{growthGap.toFixed(1)}pp
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function NetworkChart({ metrics, scoreThresholds }: { metrics: Record<string, unknown>; scoreThresholds?: ScoreThresholds | null }) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const effIdx  = n("networkEfficiencyIndex");
  const gap     = n("gapToIdealModel");
  const rank    = n("networkRank");
  const units   = n("totalNetworkUnits");

  if (effIdx === null && gap === null) return null;

  const gaugeColor = effIdx === null ? "#6b7280" : scoreRingColor(effIdx, scoreThresholds);
  const gaugeData = effIdx !== null ? [{ name: "Eficiência", value: effIdx, fill: gaugeColor }] : [];

  return (
    <div className="mt-3 flex items-center gap-4">
      {gaugeData.length > 0 && (
        <div className="relative flex-shrink-0">
          <ResponsiveContainer width={100} height={80}>
            <RadialBarChart innerRadius="55%" outerRadius="80%" startAngle={180} endAngle={0} data={gaugeData}>
              <RadialBar dataKey="value" background={{ fill: "hsl(var(--muted))" }} cornerRadius={4} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
            <span className="text-base font-bold" style={{ color: gaugeColor }}>{effIdx}</span>
            <span className="text-[10px] text-muted-foreground">Eficiência</span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5 text-xs">
        {rank !== null && <div><span className="text-muted-foreground">Posição: </span><span className="font-bold text-foreground">#{rank}</span></div>}
        {units !== null && <div><span className="text-muted-foreground">Unidades: </span><span className="font-bold text-foreground">{units}</span></div>}
        {gap !== null && <div><span className="text-muted-foreground">Gap ao ideal: </span><span className={`font-bold ${gap > 20 ? "text-red-600" : gap > 10 ? "text-yellow-600" : "text-emerald-600"}`}>{gap.toFixed(1)}%</span></div>}
      </div>
    </div>
  );
}

function StrategyChart({ metrics }: { metrics: Record<string, unknown> }) {
  const n = (k: string) => { const v = metrics[k]; return v != null ? Number(v) : null; };
  const growthPct   = n("revenueGrowthPct");
  const topProd     = n("topProductConcentrationPct");
  const newMkts     = n("newMarketsRevenuePct");
  const competitive = n("competitivePosition");

  const barData = [
    growthPct !== null && { name: "Crescimento", value: Number(growthPct.toFixed(1)), fill: "#06b6d4" },
    topProd   !== null && { name: "Concentração Prod.", value: Number(topProd.toFixed(1)), fill: "#f97316" },
    newMkts   !== null && { name: "Novos Mercados", value: Number(newMkts.toFixed(1)), fill: "#8b5cf6" },
    competitive !== null && { name: "Posição Comp.", value: Number((competitive * 10).toFixed(0)), fill: "#10b981" },
  ].filter(Boolean) as { name: string; value: number; fill: string }[];

  if (barData.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-xs text-muted-foreground font-medium mb-1">Indicadores Estratégicos</p>
      <ResponsiveContainer width="100%" height={barData.length * 36 + 20}>
        <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={['auto','auto']} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
          <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
          <ReferenceLine x={0} stroke="hsl(var(--border))" />
          <Bar dataKey="value" name="Valor" radius={[0, 3, 3, 0]}>
            {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-2">
        {String(metrics.growthClassification ?? "") && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
            {String(metrics.growthClassification)}
          </span>
        )}
        {String(metrics.maturityClassification ?? "") && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
            {String(metrics.maturityClassification)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Dispatch chart by engine ────────────────────────────────────────── */
function EngineChart({
  engine,
  metrics,
  scoreThresholds,
  onNavigateToData,
}: {
  engine: string;
  metrics: Record<string, unknown>;
  scoreThresholds?: ScoreThresholds | null;
  onNavigateToData?: (target: Omit<DataEntryNavigationTarget, "period">) => void;
}) {
  switch (engine) {
    case "financial":          return <FinancialChart metrics={metrics} />;
    case "commercial":         return <CommercialChart metrics={metrics} onNavigateToData={onNavigateToData} />;
    case "marketing":          return <MarketingChart metrics={metrics} onNavigateToData={onNavigateToData} />;
    case "operations":         return <OperationsChart metrics={metrics} onNavigateToData={onNavigateToData} />;
    case "hr":                 return <HRChart metrics={metrics} onNavigateToData={onNavigateToData} />;
    case "risks":              return <RisksChart metrics={metrics} />;
    case "innovation":         return <InnovationChart metrics={metrics} />;
    case "market_intelligence":return <MarketIntelligenceChart metrics={metrics} />;
    case "network":            return <NetworkChart metrics={metrics} scoreThresholds={scoreThresholds} />;
    case "strategy":           return <StrategyChart metrics={metrics} />;
    default:                   return null;
  }
}

/* ── Score ring ──────────────────────────────────────────────────────── */
function ScoreRing({ score, scoreThresholds }: { score: number | null; scoreThresholds?: ScoreThresholds | null }) {
  if (score === null)
    return <div className="w-12 h-12 rounded-full border-4 border-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">N/A</div>;
  const color = scoreRingColor(score, scoreThresholds);
  const r = 19, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative w-12 h-12 flex-shrink-0">
      <svg width="48" height="48" className="-rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

/* ── Highlight tile ──────────────────────────────────────────────────── */
function HighlightTile({ label, value }: { label: string; value: string }) {
  if (!value || value === "—") return null;
  return (
    <div className="bg-background/70 rounded-lg px-3 py-2 border border-border min-w-0">
      <p className="text-xs text-muted-foreground leading-tight truncate">{label}</p>
      <p className="text-sm font-semibold text-foreground truncate">{value}</p>
    </div>
  );
}

/* ── Finding card (engine dashboard) ────────────────────────────────── */
function FindingCard({
  finding,
  scoreThresholds,
  isUpdating = false,
  isMetricsRefreshed = false,
  onNavigateToData,
}: {
  finding: AnalysisFinding;
  scoreThresholds?: ScoreThresholds | null;
  isUpdating?: boolean;
  isMetricsRefreshed?: boolean;
  onNavigateToData?: (target: Omit<DataEntryNavigationTarget, "period">) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta   = ENGINE_META[finding.engine] ?? { label: finding.engine, icon: Activity, color: "text-primary", bg: "bg-muted/30", border: "border-border", highlights: [] };
  const impact = IMPACT_CONFIG[finding.impact] ?? IMPACT_CONFIG.medium;
  const Icon       = meta.icon;
  const ImpactIcon = impact.icon;
  const metrics    = finding.metrics as Record<string, unknown> | undefined;
  const score: number | null = (metrics?.score as number | null) ?? null;

  // Highlight metrics — always visible (only those with real values)
  const highlights = (meta.highlights ?? []).map(k => ({
    key: k, label: METRIC_LABELS[k] ?? k, value: formatMetric(k, metrics?.[k]),
  })).filter(h => h.value !== "—");

  // Secondary metrics — in the expandable section
  const secondary = Object.entries(metrics ?? {}).filter(
    ([k, v]) => !SKIP_METRIC_KEYS.has(k) && !meta.highlights.includes(k) && v !== null && v !== undefined && v !== "",
  );

  const noteVal = (metrics?.note as string | undefined);
  const hasChart = metrics && Object.keys(metrics).length > 1;

  return (
    <Card className={`border ${meta.border} ${meta.bg} transition-all ${isUpdating ? "opacity-60 animate-pulse" : ""}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <ScoreRing score={score} scoreThresholds={scoreThresholds} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {isUpdating
                ? <Loader2 className={`w-4 h-4 ${meta.color} flex-shrink-0 animate-spin`} />
                : <Icon className={`w-4 h-4 ${meta.color} flex-shrink-0`} />}
              <span className="font-semibold text-foreground text-sm">{meta.label}</span>
              {isUpdating
                ? <Badge variant="outline" className="text-xs text-muted-foreground border-border">atualizando…</Badge>
                : (
                  <Badge variant={impact.variant} className="text-xs gap-1">
                    <ImpactIcon className="w-3 h-3" />
                    {impact.label}
                  </Badge>
                )}
              {/* Spot-check refresh label — makes it explicit that only metrics were updated */}
              {isMetricsRefreshed && !isUpdating && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 font-medium">
                  métricas atualizadas · diagnóstico anterior
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-snug">{finding.summary}</p>
          </div>
        </div>

        {/* Highlight tiles — always visible */}
        {highlights.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {highlights.map(h => <HighlightTile key={h.key} label={h.label} value={h.value} />)}
          </div>
        )}

        {/* Engine chart visualization */}
        {hasChart && metrics && (
          <EngineChart
            engine={finding.engine}
            metrics={metrics}
            scoreThresholds={scoreThresholds}
            onNavigateToData={onNavigateToData}
          />
        )}

        {/* Note (for engines with no data) */}
        {noteVal && (
          <p className="text-xs text-muted-foreground/70 italic px-1">{noteVal}</p>
        )}

        {/* Expandable secondary metrics */}
        {secondary.length > 0 && (
          <>
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Ocultar" : `Ver ${secondary.length} métrica${secondary.length > 1 ? "s" : ""} adicional${secondary.length > 1 ? "is" : ""}`}
            </button>
            {expanded && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {secondary.map(([k, v]) => (
                  <div key={k} className="bg-background/60 rounded-md px-2.5 py-1.5 border border-border">
                    <p className="text-xs text-muted-foreground leading-tight">{METRIC_LABELS[k] ?? k}</p>
                    <p className="text-sm font-semibold text-foreground">{formatMetric(k, v)}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── History run type ────────────────────────────────────────────────── */
interface AnalysisRun {
  id: number;
  companyId: number;
  period: string;
  engines: string[];
  status: string;
  createdAt: string;
  isPartial: boolean;
  engineLastRunAt?: Record<string, string>;
  findings: AnalysisFinding[];
  blufRecommendation: string;
}

/* ── History panel ───────────────────────────────────────────────────── */
function HistoryPanel({
  runs,
  activeRunId,
  onSelect,
}: {
  runs: AnalysisRun[];
  activeRunId: number | null;
  onSelect: (run: AnalysisRun) => void;
}) {
  const [open, setOpen] = useState(false);

  if (runs.length === 0) return null;

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 text-sm font-medium text-foreground transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <History className="w-4 h-4 text-muted-foreground" />
        <span>Histórico de análises</span>
        <Badge variant="secondary" className="ml-1 text-xs">{runs.length}</Badge>
        <span className="ml-auto">
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {runs.map(run => {
            const isActive = run.id === activeRunId;
            const engineLabels = run.engines
              .map(engine => ENGINE_META[engine]?.label ?? engine)
              .join(", ");
            const highCount = run.findings.filter(f => f.impact === "high").length;
            const mediumCount = run.findings.filter(f => f.impact === "medium").length;
            const lowCount = run.findings.filter(f => f.impact === "low").length;
            return (
              <button
                key={run.id}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors ${isActive ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                onClick={() => onSelect(run)}
              >
                {run.isPartial
                  ? <Activity className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  : <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{run.period}</span>
                    {run.isPartial && (
                      <Badge variant="secondary" className="text-xs gap-1 text-blue-700 dark:text-blue-300">
                        <Activity className="w-3 h-3" /> parcial
                      </Badge>
                    )}
                    {isActive && (
                      <Badge variant="outline" className="text-xs text-primary border-primary/40">exibindo</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{fmtDate(run.createdAt)}</p>
                  {run.isPartial && (
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5 truncate" title={`${engineLabels} · parcial`}>
                      {engineLabels} · parcial
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {highCount > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                      {highCount}↑
                    </span>
                  )}
                  {mediumCount > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400">
                      {mediumCount}~
                    </span>
                  )}
                  {lowCount > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      {lowCount}✓
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── All engine keys in display order ────────────────────────────────── */
const ALL_ENGINE_KEYS = Object.keys(ENGINE_META) as (keyof typeof ENGINE_META)[];

/* ── Engine selector chip ────────────────────────────────────────────── */
function EngineChip({
  engineKey,
  selected,
  running,
  stale,
  onToggle,
}: {
  engineKey: string;
  selected: boolean;
  running: boolean;
  stale: boolean;
  onToggle: () => void;
}) {
  const meta = ENGINE_META[engineKey];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={running}
      title={stale
        ? `${meta.label} está desatualizado — clique para selecioná-lo para atualização`
        : selected ? `Remover ${meta.label} do spot-check` : `Adicionar ${meta.label} ao spot-check`}
      className={[
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all select-none",
        selected
          ? `${meta.bg} ${meta.border} ${meta.color} ring-1 ring-current/30`
          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60",
        running ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      {running
        ? <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
        : <Icon className="w-3 h-3 flex-shrink-0" />}
      {meta.label}
      {stale && (
        <span
          className="inline-flex items-center"
          aria-label="Dados desatualizados"
          title="Dados atualizados desde a última execução deste motor"
        >
          <AlertTriangle className="w-3 h-3 text-amber-500" />
        </span>
      )}
    </button>
  );
}

/* ── Main panel ──────────────────────────────────────────────────────── */
interface AnalysisPanelProps {
  companyId: number;
  scoreThresholds?: ScoreThresholds | null;
  onResultChange?: (result: FullAnalysisResult | null) => void;
  onNavigateToData?: (target: DataEntryNavigationTarget) => void;
}

export default function AnalysisPanel({ companyId, scoreThresholds, onResultChange, onNavigateToData }: AnalysisPanelProps) {
  const queryClient = useQueryClient();
  const [result, setResult]         = useState<FullAnalysisResult | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [loadedFromHistory, setLoadedFromHistory] = useState(false);

  /* ── Spot-check engine selector state ────────────────────────────── */
  // spotCheckEngines: empty set = not in spot-check mode.
  // Clicking a chip ADDS it to the set (direct selection, not deselection).
  const [spotCheckEngines, setSpotCheckEngines] = useState<Set<string>>(new Set());
  const [runningEngines, setRunningEngines] = useState<Set<string>>(new Set());
  const [selectiveError, setSelectiveError] = useState<string | null>(null);
  // Track which engines had metrics refreshed by a spot-check run (for clear labeling)
  const [refreshedEngines, setRefreshedEngines] = useState<Set<string>>(new Set());
  const [recentEngineRunAt, setRecentEngineRunAt] = useState<Record<string, string>>({});

  // Each in-flight spot-check is bound to a unique token (Symbol) plus baseline identity.
  // The token lets the finally block distinguish "am I the current request?" from
  // "is some other request now in-flight with the same company/period?".
  // This prevents request A's cleanup from clearing state owned by request B.
  const inFlightRef = useRef<SpotCheckRequest | null>(null);

  /** Abort any in-flight spot-check. Call on every state change that invalidates the baseline. */
  const abortInFlight = () => {
    cancelSpotCheckRequest(inFlightRef);
  };

  const toggleSpotCheck = (key: string) => {
    setSpotCheckEngines(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  const selectSpotCheck = (key: string) => {
    setSpotCheckEngines(prev => new Set(prev).add(key));
  };

  const clearSpotCheck = () => setSpotCheckEngines(new Set());

  const isSpotCheckMode = spotCheckEngines.size > 0;

  // Reset all local analysis state whenever the company changes so we never
  // show a previous company's result for a different company.
  useEffect(() => {
    abortInFlight();
    setResult(null);
    setActiveRunId(null);
    setSelectedPeriod("");
    setLoadedFromHistory(false);
    // Also clear spot-check state so stale labels never leak across companies
    setSpotCheckEngines(new Set());
    setRefreshedEngines(new Set());
    setRecentEngineRunAt({});
    setRunningEngines(new Set());
    setSelectiveError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const { data: periods = [] } = useQuery({
    queryKey: getListPeriodsQueryKey(companyId),
    queryFn:  () => listPeriods(companyId),
    enabled:  !!companyId,
  });

  // Fetch the most recent full analysis to restore on mount
  const { data: latestRun, isLoading: latestLoading } = useQuery<AnalysisRun>({
    queryKey: ["analysis-latest", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/calculations/latest`, { credentials: "include" });
      if (!res.ok) throw new Error("no latest");
      return res.json();
    },
    enabled: !!companyId,
    retry: false,
    staleTime: 30_000,
  });

  // Fetch analysis history for the history panel
  const { data: historyRuns = [] } = useQuery<AnalysisRun[]>({
    queryKey: ["analysis-history", companyId],
    queryFn: () => listCalculationHistory(companyId) as Promise<AnalysisRun[]>,
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // Auto-load latest result when component mounts (only if no fresh result)
  useEffect(() => {
    if (!loadedFromHistory && latestRun && result === null) {
      const r: FullAnalysisResult = {
        period: latestRun.period,
        findings: latestRun.findings,
        blufRecommendation: latestRun.blufRecommendation,
        executedAt: latestRun.createdAt,
      };
      setResult(r);
      setActiveRunId(latestRun.id);
      onResultChange?.(r);
      setSelectedPeriod(latestRun.period); // #20 auto-select period of last analysis
      setLoadedFromHistory(true);
    }
  }, [latestRun, result, loadedFromHistory, onResultChange]);

  const analysisMut = useRunFullAnalysis({
    mutation: {
      onSuccess: (data) => {
        // Abort any in-flight spot-check — the new full result supersedes it
        abortInFlight();
        const r = data as FullAnalysisResult;
        setResult(r);
        setActiveRunId(null); // new run, id unknown until history refreshes
        onResultChange?.(r);
        // Full run clears all spot-check state
        clearSpotCheck();
        setRefreshedEngines(new Set());
        setRecentEngineRunAt(Object.fromEntries(ALL_ENGINE_KEYS.map((engine) => [engine, r.executedAt])));
        setRunningEngines(new Set());
        toast({ title: "Análise completa concluída" });
        queryClient.invalidateQueries({ queryKey: getListPeriodsQueryKey(companyId) });
        queryClient.invalidateQueries({ queryKey: ["analysis-history", companyId] });
        queryClient.invalidateQueries({ queryKey: ["analysis-latest", companyId] });
      },
      onError: () => toast({ title: "Erro ao executar análise", variant: "destructive" }),
    },
  });

  /* ── Spot-check engine run ────────────────────────────────────────── */
  async function handleSpotCheckRun() {
    // Requires an existing full analysis for the exact same period being displayed.
    if (
      !period ||
      runningEngines.size > 0 ||
      !result ||
      result.period !== period ||
      spotCheckEngines.size === 0
    ) return;

    // Cancel any previously started (but not yet resolved) spot-check
    abortInFlight();

    const engines = [...spotCheckEngines];
    // Snapshot the originating identity. All must still match when the response arrives.
    const originCompanyId  = companyId;
    const originPeriod     = period;
    const originResultExAt = result.executedAt ?? "";

    const ctrl = new AbortController();
    // Use a unique Symbol as the request token so the finally block can precisely identify
    // whether it owns the current inFlightRef entry — preventing request A's cleanup from
    // clearing state owned by a subsequently started request B (even if they share the same
    // company/period after a history baseline swap within the same period).
    const requestToken = Symbol("spot-check");
    inFlightRef.current = {
      token: requestToken,
      abort: ctrl,
      companyId: originCompanyId,
      period: originPeriod,
      resultIdentity: originResultExAt,
    };

    setRunningEngines(new Set(engines));
    setSelectiveError(null);
    try {
      const res = await fetch(`/api/companies/${originCompanyId}/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: ctrl.signal,
        body: JSON.stringify({ period: originPeriod, engines }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Erro ao executar spot-check");
      }
      const data = await res.json() as {
        period: string;
        results: Record<string, Record<string, unknown>>;
        priorities?: Record<string, "high" | "medium" | "low">;
        executedAt: string;
      };

      // Identity guard: the ref must still point to this exact request (same token),
      // and the server must have returned results for the originating period.
      // Any baseline change aborts the fetch via ctrl.signal before this point,
      // but we verify explicitly as a defence-in-depth measure.
      const stillOwned = shouldApplySpotCheckResponse(
        inFlightRef.current,
        requestToken,
        data.period,
      );

      if (!stillOwned) {
        // Silently discard — the baseline changed while we were waiting
        return;
      }

      // All checks passed — merge fresh metrics into the matching baseline findings.
      // Engines not in this run keep their current data unchanged.
      setResult(prev => {
        // Final guard inside the setter: must still be the same baseline
        if (!matchesSpotCheckBaseline(prev, {
          period: originPeriod,
          resultIdentity: originResultExAt,
        })) return prev;
        const updated = prev.findings.map(f => {
          const fresh = data.results[f.engine];
          if (!fresh) return f;
          return { ...f, metrics: fresh, impact: data.priorities?.[f.engine] ?? f.impact };
        });
        return { ...prev, findings: updated };
      });
      // Set refreshed labels only after the guarded merge succeeded
      setRefreshedEngines(prev => new Set([...prev, ...engines]));
      setRecentEngineRunAt(prev => ({
        ...prev,
        ...Object.fromEntries(engines.map((engine) => [engine, data.executedAt])),
      }));
      toast({ title: `Spot-check concluído — ${engines.length} motor${engines.length > 1 ? "es" : ""} com métricas atualizadas` });
      queryClient.invalidateQueries({ queryKey: ["analysis-history", companyId] });
    } catch (err: any) {
      if (err?.name === "AbortError") return; // request was cancelled — ignore silently
      setSelectiveError(err?.message ?? "Erro desconhecido");
      toast({ title: "Erro no spot-check", description: err?.message, variant: "destructive" });
    } finally {
      // Only clear running/ref state if this is still the request that owns inFlightRef.
      // Using the unique Symbol token prevents request A's finally from clobbering
      // state owned by a later request B that started after A was aborted.
      if (ownsSpotCheckRequest(inFlightRef.current, requestToken)) {
        inFlightRef.current = null;
        setRunningEngines(new Set());
      }
    }
  }

  function handleSelectHistoryRun(run: AnalysisRun) {
    // Abort any in-flight spot-check before changing the baseline
    abortInFlight();
    const r: FullAnalysisResult = {
      period: run.period,
      findings: run.findings,
      blufRecommendation: run.blufRecommendation,
      executedAt: run.createdAt,
    };
    setResult(r);
    setActiveRunId(run.id);
    onResultChange?.(r);
    // Changing the baseline clears spot-check state to prevent stale refresh labels
    setSpotCheckEngines(new Set());
    setRefreshedEngines(run.isPartial ? new Set(run.engines) : new Set());
    setRecentEngineRunAt({});
    setRunningEngines(new Set());
    setSelectiveError(null);
    // Sync period selector to the history run's period so the periods match
    setSelectedPeriod(syncPeriodFromHistoryRun(run));
  }

  // History can contain a run for a period whose data row is no longer
  // present. Keep those periods available so selecting any historical run
  // can still be represented by the controlled selector.
  const periodOptions = derivePeriodOptions(periods, historyRuns);
  const period = deriveEffectivePeriod(selectedPeriod, periods, historyRuns);

  // Spot-check is only valid when the displayed result matches the currently selected period.
  // This ensures no cross-period metric merges can occur.
  const resultPeriodMatchesCurrent = result?.period === period;

  // Fetch the period data timestamp to detect stale engines independently.
  const { data: periodDataMeta } = useQuery<{ updatedAt?: string } | null>({
    queryKey: ["company-period-meta", companyId, period],
    queryFn: async () => {
      if (!period) return null;
      const res = await fetch(`/api/companies/${companyId}/data?period=${encodeURIComponent(period)}`, { credentials: "include" });
      if (!res.ok) return null;
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      return row ? { updatedAt: row.updatedAt } : null;
    },
    enabled: !!companyId && !!period,
    staleTime: 30_000,
  });

  const activeHistoryRun = activeRunId === null
    ? undefined
    : historyRuns.find((run) => run.id === activeRunId && run.period === period);
  const latestPeriodHistory = historyRuns.find((run) => run.period === period);
  const engineLastRunAt = {
    ...(activeHistoryRun?.engineLastRunAt
      ?? (activeRunId === null ? latestPeriodHistory?.engineLastRunAt : undefined)
      ?? {}),
    ...recentEngineRunAt,
  };
  const isEngineStale = (engine: string) => {
    if (!periodDataMeta?.updatedAt) return false;
    const lastRunAt = engineLastRunAt[engine];
    return !lastRunAt || new Date(periodDataMeta.updatedAt) > new Date(lastRunAt);
  };

  // Compare the period data with the run being displayed, not the newest run
  // in history. A newer run for the same period must not hide stale data in an
  // older result selected from the history panel.
  const displayedRunAt = activeHistoryRun?.createdAt ?? result?.executedAt;
  const dataChangedAfterAnalysis =
    !!periodDataMeta?.updatedAt &&
    !!displayedRunAt &&
    result?.period === period &&
    new Date(periodDataMeta.updatedAt) > new Date(displayedRunAt);

  const highCount   = result?.findings.filter(f => f.impact === "high").length   ?? 0;
  const mediumCount = result?.findings.filter(f => f.impact === "medium").length ?? 0;
  const lowCount    = result?.findings.filter(f => f.impact === "low").length    ?? 0;

  const isRestored  = result !== null && !analysisMut.isPending && activeRunId !== null;
  const anyRunning  = analysisMut.isPending || runningEngines.size > 0;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="space-y-3">
        {/* Top row: title + period selector + action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Motores de Análise</h2>
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
            <select
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
              // Use the effective period here as well as below. This keeps
              // the visible selector aligned with the displayed result after
              // a history selection and preserves explicit manual choices.
              value={period}
              onChange={e => {
                // Abort any in-flight spot-check before changing the period
                abortInFlight();
                setSelectedPeriod(e.target.value);
                // Changing the period clears any active spot-check to prevent cross-period merges
                setSpotCheckEngines(new Set());
                setRefreshedEngines(new Set());
                setRecentEngineRunAt({});
                setRunningEngines(new Set());
                setSelectiveError(null);
              }}
              disabled={anyRunning}
            >
              <option value="">Período mais recente</option>
              {periodOptions.map(periodOption => (
                <option key={periodOption} value={periodOption}>{periodOption}</option>
              ))}
            </select>

            {/* Spot-check run — visible when engines selected AND result exists for the same period */}
            {isSpotCheckMode && result && resultPeriodMatchesCurrent && (
              <Button
                size="sm"
                variant="outline"
                disabled={!period || anyRunning}
                onClick={handleSpotCheckRun}
              >
                {runningEngines.size > 0
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Activity className="w-4 h-4 mr-2" />}
                Spot-check ({spotCheckEngines.size})
              </Button>
            )}

            {/* Full analysis — always present */}
            <Button
              size="sm"
              disabled={!period || anyRunning}
              onClick={() => analysisMut.mutate({ id: companyId, data: { period } })}
            >
              {analysisMut.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Play className="w-4 h-4 mr-2" />}
              Analisar tudo
            </Button>
          </div>
        </div>

        {/* Spot-check engine chips — click to add engine to the spot-check set */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">Spot-check:</span>
            {ALL_ENGINE_KEYS.map(key => (
              <EngineChip
                key={key}
                engineKey={key}
                selected={spotCheckEngines.has(key)}
                running={runningEngines.has(key)}
                stale={isEngineStale(key)}
                onToggle={() => isEngineStale(key) ? selectSpotCheck(key) : toggleSpotCheck(key)}
              />
            ))}
            {isSpotCheckMode && (
              <button
                type="button"
                onClick={clearSpotCheck}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline ml-1"
              >
                Limpar
              </button>
            )}
          </div>
          {/* Hint text */}
          {!isSpotCheckMode && (
            <p className="text-xs text-muted-foreground/70">
              Clique em um motor para rodar apenas ele — os demais resultados permanecem visíveis.
            </p>
          )}
          {/* Spot-check requires a full analysis baseline for the same period */}
          {isSpotCheckMode && (!result || !resultPeriodMatchesCurrent) && !analysisMut.isPending && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {!result
                ? 'Execute "Analisar tudo" primeiro. O spot-check atualiza métricas de motores específicos a partir de um diagnóstico base.'
                : `O diagnóstico exibido é do período ${result.period}. Selecione esse período ou execute "Analisar tudo" para usar o spot-check neste período.`}
            </p>
          )}
          {/* Info banner when spot-check is active and result period matches */}
          {isSpotCheckMode && result && resultPeriodMatchesCurrent && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-1.5">
              <Activity className="w-3 h-3 text-blue-500 flex-shrink-0" />
              <span>
                {spotCheckEngines.size} motor{spotCheckEngines.size > 1 ? "es" : ""} selecionado{spotCheckEngines.size > 1 ? "s" : ""}. Os demais resultados permanecem visíveis sem ser recalculados.
              </span>
            </div>
          )}
        </div>

        {/* Spot-check error */}
        {selectiveError && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {selectiveError}
          </div>
        )}
      </div>

      {/* The selected result predates the current period data. */}
      {dataChangedAfterAnalysis && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-700 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-yellow-600 dark:text-yellow-400" />
          <span>
            Dados atualizados desde a última análise — clique em <strong>Analisar tudo</strong> para atualizar os resultados.
          </span>
        </div>
      )}

      {/* Empty state */}
      {!result && !analysisMut.isPending && !latestLoading && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Brain className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-lg font-medium text-foreground">Análise não executada</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Selecione um período com dados inseridos e clique em "Analisar" para rodar os 9 motores de inteligência gerencial.
            </p>
            {periods.length === 0 && (
              <p className="text-xs text-muted-foreground/70 mt-2">
                Nenhum dado financeiro cadastrado — insira dados na aba "Dados" primeiro.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading latest from server */}
      {!result && latestLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Loading skeleton for fresh analysis */}
      {analysisMut.isPending && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Results */}
      {result && !analysisMut.isPending && (
        <>
          {/* Restored-from-history banner */}
          {isRestored && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border">
              <History className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Resultado carregado do histórico — clique em "Analisar" para executar uma nova análise.</span>
            </div>
          )}

          {/* BLUF */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex gap-3">
              <Brain className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">
                  Recomendação Principal · Período {result.period}
                </p>
                <p className="text-sm text-foreground leading-relaxed">{result.blufRecommendation}</p>
              </div>
            </CardContent>
          </Card>

          {/* Summary badges */}
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">{result.findings.length} motores analisados:</span>
            {highCount > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="w-3 h-3" /> {highCount} alta prioridade
              </Badge>
            )}
            {mediumCount > 0 && (
              <Badge variant="secondary" className="gap-1">
                <TrendingDown className="w-3 h-3" /> {mediumCount} média prioridade
              </Badge>
            )}
            {lowCount > 0 && (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700">
                <CheckCircle2 className="w-3 h-3" /> {lowCount} boa performance
              </Badge>
            )}
          </div>

          {/* Engine dashboards: high → medium → low */}
          <div className="space-y-3">
            {[...result.findings]
              .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.impact] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.impact] ?? 1))
              .map((finding, i) => (
                <FindingCard
                  key={`${finding.engine}-${i}`}
                  finding={finding}
                  scoreThresholds={scoreThresholds}
                  isUpdating={runningEngines.has(finding.engine)}
                  isMetricsRefreshed={refreshedEngines.has(finding.engine)}
                  onNavigateToData={onNavigateToData && ((target) => onNavigateToData({ ...target, period }))}
                />
              ))}
          </div>
        </>
      )}

      {/* History panel — always shown when there are runs */}
      {historyRuns.length > 0 && !analysisMut.isPending && (
        <HistoryPanel
          runs={historyRuns}
          activeRunId={activeRunId}
          onSelect={handleSelectHistoryRun}
        />
      )}
    </div>
  );
}
