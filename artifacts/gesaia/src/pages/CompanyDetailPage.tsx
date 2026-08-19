import { useParams } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCompany,
  getGetCompanyQueryKey,
  getListPeriodsQueryKey,
  useRunCalculation,
} from "@workspace/api-client-react";
import {
  Building2,
  BarChart3,
  MessageSquare,
  FlaskConical,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Play,
  Loader2,
  Brain,
  FileDown,
  GitCompare,
  Stethoscope,
  FileText,
} from "lucide-react";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import InvestigationPanel from "@/components/company/InvestigationPanel";
import SimulationPanel from "@/components/company/SimulationPanel";
import DataEntryPanel from "@/components/company/DataEntryPanel";
import AnalysisPanel from "@/components/company/AnalysisPanel";
import BridgePanel from "@/components/company/BridgePanel";
import QuickDiagnosisPanel from "@/components/company/QuickDiagnosisPanel";
import FullReportPanel from "@/components/company/FullReportPanel";
import ReportsPanel, {
  getCompanyReportsQueryKey,
} from "@/components/company/ReportsPanel";
import {
  hasCompletedFullAnalysisForPeriod,
  type PeriodAnalysisStatus,
} from "@/lib/periodAnalysis";
import { requestPdfExport } from "@/lib/pdfExport";
import { createComparisonRequestManager } from "@/lib/comparisonRequest";
import type { DataEntryNavigationTarget } from "@/components/company/dataEntryNavigation";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dataEntryTarget, setDataEntryTarget] = useState<DataEntryNavigationTarget | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const { data: company, isLoading } = useQuery({
    queryKey: getGetCompanyQueryKey(companyId),
    queryFn: () => getCompany(companyId),
    enabled: !!companyId,
  });

  const {
    data: periods,
    isLoading: loadingPeriods,
    isError: periodsError,
  } = useQuery<PeriodAnalysisStatus[]>({
    queryKey: getListPeriodsQueryKey(companyId),
    // The server calculates this status from every stored run for each period,
    // unlike the bounded history list used by the Analysis tab.
    queryFn: async () => {
      const response = await fetch(`/api/companies/${companyId}/periods`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Não foi possível carregar os períodos");
      return response.json() as Promise<PeriodAnalysisStatus[]>;
    },
    enabled: !!companyId,
  });

  const [selectedPeriod, setSelectedPeriod] = useState("");

  // ── Period comparison state (shown in Painel tab) ───────────────────────
  const [cmpBase, setCmpBase] = useState("");
  const [cmpComp, setCmpComp] = useState("");
  const [cmpResult, setCmpResult] = useState<any>(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const [noPrevPeriod, setNoPrevPeriod] = useState(false);
  const cmpRequestManager = useRef(createComparisonRequestManager<any>());

  // Reset all comparison state when navigating to a different company so that
  // stale results / a stuck spinner from the previous company never bleed through.
  useEffect(() => {
    cmpRequestManager.current.reset((state) => {
      setCmpResult(state.result);
      setCmpLoading(state.loading);
      setCmpError(state.error);
    });
    setCmpBase("");
    setCmpComp("");
    setNoPrevPeriod(false);
    hasRestoredFromStorage.current = false;
  }, [companyId]);

  // Whether we've already tried to restore from sessionStorage for this mount.
  // Using a ref so changing selectedPeriod later in the session always triggers
  // fresh auto-select instead of re-reading the stored pair.
  const hasRestoredFromStorage = useRef(false);

  // Auto-select comparison pair whenever selectedPeriod or periods change.
  // periods are newest-first from the API.
  // A manually-chosen pair is persisted in sessionStorage (keyed by company only)
  // and restored the first time periods load after a navigation/mount.
  useEffect(() => {
    if (!periods) return;

    const periodKeys = new Set(periods.map(p => p.period));
    const storageKey = `cmp-${companyId}`;
    const storagePrefix = `${storageKey}-`;

    // Remove comparison entries for deleted periods as soon as the periods list
    // changes. Clear the whole company-scoped family if any entry is stale so
    // that an older saved choice cannot be restored in another context later.
    try {
      const companyStorageKeys: string[] = [];
      const staleStorageKeys: string[] = [];

      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (!key || (key !== storageKey && !key.startsWith(storagePrefix))) continue;

        companyStorageKeys.push(key);

        if (key.startsWith(storagePrefix)) {
          const period = key.slice(storagePrefix.length);
          if (!periodKeys.has(period)) staleStorageKeys.push(key);
          continue;
        }

        const saved = sessionStorage.getItem(key);
        if (!saved) {
          staleStorageKeys.push(key);
          continue;
        }

        try {
          const { base, comp } = JSON.parse(saved) as { base?: string; comp?: string };
          if (!base || !comp || base === comp || !periodKeys.has(base) || !periodKeys.has(comp)) {
            staleStorageKeys.push(key);
          }
        } catch {
          staleStorageKeys.push(key);
        }
      }

      if (staleStorageKeys.length > 0) {
        companyStorageKeys.forEach(key => sessionStorage.removeItem(key));
      }
    } catch {
      // sessionStorage unavailable — proceed with auto-select.
    }

    if (periods.length < 2) return;

    // On fresh mount / return from navigation: restore the last manual override.
    // After that, any selectedPeriod change uses auto-select as normal.
    if (!hasRestoredFromStorage.current) {
      hasRestoredFromStorage.current = true;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const { base, comp } = JSON.parse(saved) as { base: string; comp: string };
          const periodKeys = new Set(periods.map(p => p.period));
          if (base && comp && periodKeys.has(base) && periodKeys.has(comp) && base !== comp) {
            setCmpBase(base);
            setCmpComp(comp);
            setCmpResult(null);
            setNoPrevPeriod(false);
            return;
          }
          // Stale entry — remove it and fall through to auto-select.
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        // sessionStorage unavailable — proceed with auto-select.
      }
    }

    if (selectedPeriod) {
      // Find the selected period in the list and use the next one as base.
      const idx = periods.findIndex(p => p.period === selectedPeriod);
      if (idx !== -1 && idx + 1 < periods.length) {
        // prev period exists: base = periods[idx+1], comp = selectedPeriod
        setCmpBase(periods[idx + 1].period);
        setCmpComp(selectedPeriod);
        setCmpResult(null);
        setNoPrevPeriod(false);
      } else {
        // selectedPeriod is the oldest — no predecessor available
        setCmpBase("");
        setCmpComp("");
        setCmpResult(null);
        setNoPrevPeriod(true);
      }
    } else {
      // "All periods" selected — default to newest vs second-newest
      setCmpBase(periods[1].period);
      setCmpComp(periods[0].period);
      setCmpResult(null);
      setNoPrevPeriod(false);
    }
  }, [selectedPeriod, periods, companyId]);

  // Auto-fetch comparison when both periods are set; cancel any in-flight request first.
  useEffect(() => {
    if (!cmpBase || !cmpComp || cmpBase === cmpComp) return;
    return cmpRequestManager.current.start(
      { companyId, periodBase: cmpBase, periodComp: cmpComp },
      (state) => {
        setCmpResult(state.result);
        setCmpLoading(state.loading);
        setCmpError(state.error);
      },
    );
  }, [cmpBase, cmpComp, companyId]);

  const { data: dashData, isLoading: loadingDash } = useQuery({
    queryKey: ["company-dashboard", companyId, selectedPeriod],
    queryFn: async () => {
      const params = selectedPeriod ? `?period=${selectedPeriod}` : "";
      const res = await fetch(`/api/dashboard/companies/${companyId}${params}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: kpiHistory } = useQuery({
    queryKey: ["kpi-history", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/companies/${companyId}/kpi-history`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!companyId,
  });

  const runCalcMut = useRunCalculation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["company-dashboard", companyId] });
        qc.invalidateQueries({ queryKey: getListPeriodsQueryKey(companyId) });
        toast({ title: "Cálculo executado com sucesso" });
      },
    },
  });

  const handleExportPdf = async () => {
    if (!company) return;
    setExportingPdf(true);
    try {
      const dashPeriod = selectedPeriod || periods?.[0]?.period;

      // Always fetch analysis runs from the server — never rely on tab state,
      // since Radix unmounts inactive tabs and AnalysisPanel may never have mounted.
      const runsRes = await fetch(`/api/companies/${companyId}/calculations`, {
        credentials: "include",
      });
      const allRuns: any[] = runsRes.ok ? await runsRes.json() : [];

      // Find best matching run: prefer exact period match, fall back to most recent
      let matchedRun: any = null;
      let periodMismatch = false;

      if (allRuns.length > 0) {
        if (dashPeriod) {
          matchedRun = allRuns.find((r: any) => r.period === dashPeriod) ?? null;
          if (!matchedRun) {
            matchedRun = allRuns[0]; // most recent
            periodMismatch = true;
          }
        } else {
          matchedRun = allRuns[0]; // most recent overall
        }
      }

      if (periodMismatch && matchedRun) {
        // #23 — block stale PDF: require user to run analysis for the selected period first
        toast({
          title: "Análise desatualizada",
          description: `Não há análise para o período ${dashPeriod}. Execute a análise na aba "Análise" antes de gerar o PDF.`,
          variant: "destructive",
        });
        setExportingPdf(false);
        return;
      } else if (!matchedRun) {
        toast({
          title: "Análise não executada",
          description: "O PDF será gerado sem resultados de IA. Acesse a aba \"Análise\" e clique em \"Analisar\" para incluir os findings no próximo relatório.",
        });
      }

      const kpis = dashData?.kpis?.map((k: any) => ({
        label: k.label,
        value: k.value != null
          ? k.unit === "%" ? `${Number(k.value).toFixed(1)}%`
          : k.unit === "BRL" ? `R$ ${Math.round(k.value).toLocaleString("pt-BR")}`
          : k.unit === "dias" ? `${Math.round(k.value)} dias`
          : Number(k.value).toFixed(1)
          : "—",
        status: k.status ?? "neutral",
      })) ?? [];

      const alerts = dashData?.alerts?.map((a: any) => ({
        message: a.message,
        severity: a.severity,
        engine: a.engine,
      })) ?? [];

      const findings = (matchedRun?.findings ?? []).map((f: any) => ({
        engine: f.engine,
        title: f.title,
        impact: f.impact,
        summary: f.summary,
        score: (f.metrics?.score as number | null | undefined) ?? null,
      }));

      // Use the analysis run's own period label so it stays internally consistent
      const analysisPeriod = matchedRun?.period ?? dashPeriod;
      const analysisPeriodIndex = analysisPeriod
        ? periods?.findIndex((p) => p.period === analysisPeriod) ?? -1
        : -1;
      const previousPeriod = analysisPeriodIndex >= 0
        ? periods?.[analysisPeriodIndex + 1]?.period
        : undefined;
      const previousRun = previousPeriod
        ? allRuns.find((run: any) => run.period === previousPeriod)
        : undefined;
      const previousFindings = previousRun
        ? (previousRun.findings ?? []).map((f: any) => ({
            engine: f.engine,
            title: f.title,
            impact: f.impact,
            summary: f.summary,
            score: (f.metrics?.score as number | null | undefined) ?? null,
          }))
        : undefined;

      // Call server-side PDF generation (also persists report to DB).
      // requestPdfExport throws on non-OK responses, so qc.invalidateQueries
      // is only reached when the export actually succeeded.
      const blob = await requestPdfExport(
        {
          companyId,
          companyName: company.name,
          segment: company.segment,
          activity: company.activity,
          businessModel: company.businessModel,
          period: analysisPeriod,
          generatedAt: new Date().toLocaleString("pt-BR"),
          kpis,
          alerts,
          findings,
          previousFindings,
          blufRecommendation: matchedRun?.blufRecommendation ?? null,
        },
        () => qc.invalidateQueries({ queryKey: getCompanyReportsQueryKey(companyId) }),
      );

      // Download the returned PDF blob
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GESAIA_${company.name.replace(/\s+/g, "_")}${analysisPeriod ? `_${analysisPeriod}` : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "PDF exportado com sucesso" });
    } catch (e) {
      toast({ title: "Erro ao gerar PDF", variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-48 mb-8" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-center py-20">
        <p className="text-muted-foreground">Empresa não encontrada</p>
        <Link href="/companies">
          <Button variant="outline" className="mt-4" asChild>
            <span><ArrowLeft className="w-4 h-4 mr-2" /> Voltar</span>
          </Button>
        </Link>
      </div>
    );
  }

  const latestPeriod = selectedPeriod || periods?.[0]?.period || "";
  const selectedPeriodHasAnalysis = selectedPeriod
    ? hasCompletedFullAnalysisForPeriod(periods ?? [], selectedPeriod)
    : true;
  const showMissingAnalysisWarning =
    !!selectedPeriod &&
    !loadingPeriods &&
    !periodsError &&
    !selectedPeriodHasAnalysis;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 no-print">
        <Link
          href="/companies"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Empresas
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{company.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="secondary">{company.segment}</Badge>
                <span className="text-xs text-muted-foreground">{company.businessModel}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Period selector */}
            <select
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              <option value="">Todos os períodos</option>
              {periods?.map((p) => (
                <option key={p.period} value={p.period}>{p.period}</option>
              ))}
            </select>

            <Button
              size="sm"
              variant="outline"
              disabled={!latestPeriod || runCalcMut.isPending}
              onClick={() =>
                runCalcMut.mutate({
                  id: companyId,
                  data: {
                    period: latestPeriod,
                    engines: ["financial", "commercial", "marketing", "operations", "risks"],
                  },
                })
              }
            >
              {runCalcMut.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-1.5" />
              )}
              Calcular
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={exportingPdf}
              onClick={handleExportPdf}
              title="Exportar relatório em PDF"
            >
              {exportingPdf ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5 mr-1.5" />
              )}
              Exportar PDF
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 no-print">
          <TabsTrigger value="dashboard">
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Painel
          </TabsTrigger>
          <TabsTrigger value="analysis">
            <Brain className="w-4 h-4 mr-1.5" />
            Análise
          </TabsTrigger>
          <TabsTrigger value="data">
            <TrendingUp className="w-4 h-4 mr-1.5" />
            Dados
          </TabsTrigger>
          <TabsTrigger value="investigations">
            <MessageSquare className="w-4 h-4 mr-1.5" />
            Investigações
          </TabsTrigger>
          <TabsTrigger value="simulations">
            <FlaskConical className="w-4 h-4 mr-1.5" />
            Simulações
          </TabsTrigger>
          <TabsTrigger value="bridge">
            <GitCompare className="w-4 h-4 mr-1.5" />
            Evolução
          </TabsTrigger>
          <TabsTrigger value="diagnosis">
            <Stethoscope className="w-4 h-4 mr-1.5" />
            Diagnóstico
          </TabsTrigger>
          <TabsTrigger value="reports">
            <FileText className="w-4 h-4 mr-1.5" />
            Relatórios
          </TabsTrigger>
        </TabsList>

        {/* DASHBOARD TAB */}
        <TabsContent value="dashboard" className="space-y-6">
          {showMissingAnalysisWarning && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-medium">Ainda não há uma análise para o período {selectedPeriod}.</p>
                <p className="mt-0.5">
                  Execute a análise na aba &quot;Análise&quot; antes de exportar o relatório deste período.
                </p>
              </div>
            </div>
          )}
          {loadingDash ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : dashData?.kpis && dashData.kpis.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {dashData.kpis.map((kpi: any) => (
                <Card key={kpi.key}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                    <p className="text-xl font-bold text-foreground mt-1">
                      {kpi.value != null
                        ? kpi.unit === "%"
                          ? `${kpi.value.toFixed(1)}%`
                          : kpi.unit === "BRL"
                            ? `R$ ${(kpi.value / 1000).toFixed(0)}k`
                            : kpi.value.toFixed(1)
                        : "—"}
                    </p>
                    <div className="mt-2">
                      <Badge
                        variant={
                          kpi.status === "good"
                            ? "default"
                            : kpi.status === "warning"
                              ? "secondary"
                              : kpi.status === "critical"
                                ? "destructive"
                                : "outline"
                        }
                        className="text-xs"
                      >
                        {kpi.status === "good"
                          ? "Bom"
                          : kpi.status === "warning"
                            ? "Atenção"
                            : kpi.status === "critical"
                              ? "Crítico"
                              : "Neutro"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center">
                <BarChart3 className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="font-medium text-foreground">Nenhum dado disponível</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Adicione dados financeiros na aba "Dados" para ver os KPIs
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  size="sm"
                  onClick={() => setActiveTab("data")}
                >
                  Inserir Dados
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Alerts */}
          {dashData?.alerts && dashData.alerts.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-foreground mb-3">Alertas</h2>
              <div className="space-y-2">
                {dashData.alerts.map((alert: any) => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      alert.severity === "high"
                        ? "border-destructive/30 bg-destructive/5"
                        : alert.severity === "medium"
                          ? "border-yellow-500/30 bg-yellow-50 dark:bg-yellow-500/5"
                          : "border-border bg-muted/30"
                    }`}
                  >
                    <AlertTriangle
                      className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        alert.severity === "high"
                          ? "text-destructive"
                          : alert.severity === "medium"
                            ? "text-yellow-500"
                            : "text-muted-foreground"
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">{alert.message}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Motor: {alert.engine}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI History Chart */}
          {kpiHistory && kpiHistory.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Evolução de KPIs</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={kpiHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="grossMargin"          name="Margem Bruta %"    stroke="hsl(var(--chart-1))" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="ebitdaMargin"         name="EBITDA %"          stroke="hsl(var(--chart-2))" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="netMargin"            name="Margem Líq. %"     stroke="hsl(var(--chart-3))" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="contributionMarginPct" name="Marg. Contribuição %" stroke="hsl(var(--chart-4))" dot={false} strokeWidth={2} strokeDasharray="6 3" />
                    <Line type="monotone" dataKey="safetyMargin"         name="Marg. Segurança %"  stroke="hsl(var(--chart-5))" dot={false} strokeWidth={2} strokeDasharray="3 3" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ── Period Comparison Widget ─────────────────────────────────── */}
          {/* No-previous-period notice */}
          {noPrevPeriod && (
            <Card>
              <CardContent className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
                <GitCompare className="w-4 h-4 flex-shrink-0" />
                <span>Sem período anterior disponível para comparação com <strong className="text-foreground">{selectedPeriod}</strong>.</span>
              </CardContent>
            </Card>
          )}

          {/* ── Period Comparison Widget ─────────────────────────────────── */}
          {periods && periods.length >= 2 && !noPrevPeriod && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <GitCompare className="w-4 h-4 text-primary" />
                    Comparação entre Períodos
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground"
                      value={cmpBase}
                      onChange={e => {
                        const v = e.target.value;
                        setCmpBase(v);
                        setCmpResult(null);
                        try {
                          sessionStorage.setItem(
                            `cmp-${companyId}`,
                            JSON.stringify({ base: v, comp: cmpComp }),
                          );
                        } catch {}
                      }}
                    >
                      <option value="">Base</option>
                      {periods.map(p => <option key={p.period} value={p.period}>{p.period}</option>)}
                    </select>
                    <span className="text-muted-foreground text-xs">→</span>
                    <select
                      className="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground"
                      value={cmpComp}
                      onChange={e => {
                        const v = e.target.value;
                        setCmpComp(v);
                        setCmpResult(null);
                        try {
                          sessionStorage.setItem(
                            `cmp-${companyId}`,
                            JSON.stringify({ base: cmpBase, comp: v }),
                          );
                        } catch {}
                      }}
                    >
                      <option value="">Comparativo</option>
                      {periods.map(p => <option key={p.period} value={p.period}>{p.period}</option>)}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2"
                      onClick={() => setActiveTab("bridge")}
                    >
                      <GitCompare className="w-3 h-3 mr-1" />
                      Análise completa
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {cmpLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />Carregando comparação…
                  </div>
                )}
                {cmpError && !cmpLoading && (
                  <p className="text-sm text-destructive py-4 text-center">{cmpError}</p>
                )}
                {cmpResult && !cmpLoading && (() => {
                  const s = cmpResult.summary;
                  const bridge = cmpResult.bridge as { label: string; value: number; description: string }[];

                  // Build waterfall chart data
                  let running = 0;
                  const chartData = bridge.map(b => {
                    const start = running;
                    running += b.value;
                    return {
                      name: b.label.replace("Efeito ", ""),
                      invisible: b.value >= 0 ? start : start + b.value,
                      value: Math.abs(b.value),
                      rawValue: b.value,
                      isPositive: b.value >= 0,
                    };
                  });
                  chartData.push({
                    name: "Δ Resultado",
                    invisible: s.operatingResult.delta >= 0 ? 0 : s.operatingResult.delta,
                    value: Math.abs(s.operatingResult.delta),
                    rawValue: s.operatingResult.delta,
                    isPositive: s.operatingResult.delta >= 0,
                  });

                  const fmt = (v: number) => `R$ ${Math.round(Math.abs(v)).toLocaleString("pt-BR")}`;
                  const sign = (v: number) => v > 0 ? "+" : v < 0 ? "−" : "";
                  const deltaColor = (v: number, invert = false) =>
                    Math.abs(v) < 1 ? "text-muted-foreground"
                    : (invert ? v < 0 : v > 0) ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-500";

                  return (
                    <div className="space-y-5">
                      {/* Diagnosis banner */}
                      <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-2 ${
                        cmpResult.diagnosis.isLeaking   ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-300"
                        : cmpResult.diagnosis.isImproving ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-300"
                        : "bg-red-50 dark:bg-red-950/20 border border-red-300"
                      }`}>
                        {cmpResult.diagnosis.isLeaking ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        ) : cmpResult.diagnosis.isImproving ? (
                          <TrendingUp className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        )}
                        <p className="text-foreground leading-snug">{cmpResult.narrative}</p>
                      </div>

                      {/* Waterfall chart */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          Decomposição do Δ Resultado Operacional
                        </p>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis tickFormatter={v => v === 0 ? "0" : `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={2} />
                            <Tooltip
                              content={({ active, payload }: any) => {
                                if (!active || !payload?.length) return null;
                                const d = payload[0]?.payload;
                                return (
                                  <div className="bg-card border border-border rounded-lg p-2 shadow text-xs">
                                    <p className="font-semibold">{d.name}</p>
                                    <p className={d.isPositive ? "text-emerald-600 font-bold" : "text-red-500 font-bold"}>
                                      {sign(d.rawValue)}{fmt(d.rawValue)}
                                    </p>
                                  </div>
                                );
                              }}
                            />
                            <Bar dataKey="invisible" stackId="a" fill="transparent" />
                            <Bar dataKey="value" stackId="a" radius={[3, 3, 0, 0]}>
                              {chartData.map((entry, i) => (
                                <Cell
                                  key={i}
                                  fill={i === chartData.length - 1
                                    ? (entry.isPositive ? "hsl(var(--chart-1))" : "hsl(var(--chart-5))")
                                    : (entry.isPositive ? "#10b981" : "#ef4444")}
                                  opacity={i === chartData.length - 1 ? 0.85 : 1}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                        {/* Bridge effect pills */}
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          {bridge.map(b => (
                            <div key={b.label} className={`rounded-lg px-2 py-1.5 border text-center ${
                              b.value > 0 ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
                              : b.value < 0 ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                              : "bg-muted border-border"
                            }`}>
                              <p className="text-[10px] text-muted-foreground leading-tight">{b.label}</p>
                              <p className={`text-xs font-bold ${b.value > 0 ? "text-emerald-700 dark:text-emerald-400" : b.value < 0 ? "text-red-600" : "text-foreground"}`}>
                                {sign(b.value)}{fmt(b.value)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Key metrics mini-table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[400px]">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="pb-1.5 text-left text-muted-foreground font-medium">Indicador</th>
                              <th className="pb-1.5 text-right text-muted-foreground font-medium">{cmpResult.periodBase}</th>
                              <th className="pb-1.5 text-right text-muted-foreground font-medium">{cmpResult.periodComp}</th>
                              <th className="pb-1.5 text-right text-muted-foreground font-medium">Variação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { label: "Receita Líquida",        key: "netRevenue",         invert: false },
                              { label: "Margem de Contribuição", key: "contributionMargin",  invert: false },
                              { label: "MC %",                   key: "mcPct",              unit: "pct" as const, invert: false },
                              { label: "Custos Fixos",           key: "fixedCosts",         invert: true  },
                              { label: "Resultado Operacional",  key: "operatingResult",    invert: false },
                            ].map(({ label, key, unit, invert }) => {
                              const row = s?.[key];
                              if (!row) return null;
                              const fmtVal = (v: number) =>
                                unit === "pct" ? `${v.toFixed(1)}%` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
                              return (
                                <tr key={key} className="border-b border-border/40 last:border-0">
                                  <td className="py-2 pr-2 text-muted-foreground">{label}</td>
                                  <td className="py-2 pr-2 text-right font-medium">{fmtVal(row.base)}</td>
                                  <td className="py-2 pr-2 text-right font-medium">{fmtVal(row.comp)}</td>
                                  <td className={`py-2 text-right font-bold ${deltaColor(row.delta, invert)}`}>
                                    {sign(row.delta)}
                                    {unit === "pct" ? `${Math.abs(row.delta).toFixed(1)}pp` : fmt(row.delta)}
                                    {row.deltaPct != null && (
                                      <span className="font-normal opacity-60 ml-1">({row.deltaPct > 0 ? "+" : ""}{row.deltaPct.toFixed(1)}%)</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
                {!cmpResult && !cmpLoading && !cmpError && cmpBase && cmpComp && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Selecione dois períodos diferentes para comparar.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ANALYSIS TAB */}
        <TabsContent value="analysis">
          <AnalysisPanel
            companyId={companyId}
            scoreThresholds={company?.scoreThresholds}
            onNavigateToData={(target) => {
              setDataEntryTarget(target);
              setActiveTab("data");
            }}
          />
        </TabsContent>

        {/* DATA TAB */}
        <TabsContent value="data">
          <DataEntryPanel
            companyId={companyId}
            navigationTarget={dataEntryTarget}
            onNavigationHandled={() => setDataEntryTarget(null)}
          />
        </TabsContent>

        {/* INVESTIGATIONS TAB */}
        <TabsContent value="investigations">
          <InvestigationPanel companyId={companyId} />
        </TabsContent>

        {/* SIMULATIONS TAB */}
        <TabsContent value="simulations">
          <SimulationPanel companyId={companyId} />
        </TabsContent>

        {/* BRIDGE / VARIAÇÕES TAB */}
        <TabsContent value="bridge">
          <BridgePanel companyId={companyId} companyName={company?.name} />
        </TabsContent>

        {/* RELATÓRIOS TAB */}
        <TabsContent value="reports">
          <ReportsPanel companyId={companyId} />
        </TabsContent>

        {/* DIAGNÓSTICO TAB */}
        <TabsContent value="diagnosis">
          <Tabs defaultValue="full">
            <TabsList className="mb-6">
              <TabsTrigger value="full">Relatório Completo</TabsTrigger>
              <TabsTrigger value="quick">Diagnóstico Rápido</TabsTrigger>
            </TabsList>
            <TabsContent value="full">
              <FullReportPanel
                companyId={companyId}
                companyName={company?.name}
                onGoToData={() => setActiveTab("data")}
              />
            </TabsContent>
            <TabsContent value="quick">
              <QuickDiagnosisPanel companyId={companyId} companyName={company?.name} />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
