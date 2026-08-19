import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  FileText,
  FileDown,
  RefreshCw,
  Settings2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ListChecks,
  Lightbulb,
  Target,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface FullReportPanelProps {
  companyId: number;
  companyName?: string;
  onGoToData?: () => void;
}

type Threshold = { bounds: [number, number, number, number]; direction: "higher" | "lower" };

interface ScoreItem {
  key: string;
  label: string;
  unit?: string;
  value?: number | null;
  score?: number | null;
  level: number | null;
  levelLabel: string;
  emoji: string;
}

interface ReportData {
  period: string;
  sector: string;
  generatedAt: string;
  scorecard: { indicators: ScoreItem[]; engines: ScoreItem[] };
  missingFields: string[];
  blufRecommendation: string | null;
  narrative: {
    executiveSummary?: string;
    sections?: {
      key: string;
      title: string;
      narrative: string;
      causes?: string[];
      suggestions?: { action: string; expectedImpact?: string }[];
    }[];
    nextSteps?: string;
  } | null;
  aiError: string | null;
}

interface ScorecardComparison {
  period: string;
  source: "saved_report" | "calculated_from_data";
  scorecard: {
    indicators: ScoreItem[];
    engines: ScoreItem[];
  };
}

interface SettingsData {
  sector: string;
  thresholds: Record<string, Threshold>;
  sectorOptions: string[];
  indicatorDefs: { key: string; label: string; unit: string }[];
  sectorDefaults: Record<string, Record<string, Threshold>>;
}

interface PreflightData {
  hasData: boolean;
  checklist: { group: string; fields: { key: string; label: string; filled: boolean }[] }[];
  missingCount: number;
  totalCount: number;
}

const SECTOR_LABELS: Record<string, string> = {
  geral: "Geral",
  varejo: "Varejo / Comércio",
  servicos: "Serviços",
  industria: "Indústria",
  tecnologia: "Tecnologia / SaaS",
};

const LEVEL_STYLES: Record<number, string> = {
  0: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",
  1: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400",
  2: "bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-500",
  3: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400",
  4: "bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400",
};

function fmtValue(item: ScoreItem): string {
  const v = item.value ?? item.score;
  if (v == null) return "—";
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  if (item.unit === "%") return `${rounded}%`;
  if (item.unit === "dias") return `${Math.round(v)} dias`;
  if (item.unit === "pts") return `${rounded} pts`;
  return `${rounded}`;
}

function ScoreRow({
  item,
  showScore,
  previousItems,
}: {
  item: ScoreItem;
  showScore?: boolean;
  previousItems?: Record<string, ScoreItem>;
}) {
  const style = item.level != null ? LEVEL_STYLES[item.level] : "bg-muted/40 border-border text-muted-foreground";
  const previousItem = previousItems?.[item.key];
  const delta = item.level != null && previousItem?.level != null
    ? item.level - previousItem.level
    : null;
  const deltaSymbol = delta == null ? null : delta > 0 ? "▲" : delta < 0 ? "▼" : "=";
  const deltaClass = delta == null
    ? ""
    : delta > 0
      ? "text-emerald-700 dark:text-emerald-400"
      : delta < 0
        ? "text-red-700 dark:text-red-400"
        : "text-muted-foreground";
  const deltaLabel = delta == null
    ? null
    : delta > 0
      ? `Subiu de ${previousItem?.levelLabel ?? "Dados não informados"} para ${item.levelLabel}`
      : delta < 0
        ? `Caiu de ${previousItem?.levelLabel ?? "Dados não informados"} para ${item.levelLabel}`
        : `Permaneceu em ${item.levelLabel}`;

  return (
    <div className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${style}`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-lg shrink-0">{item.emoji}</span>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate text-foreground flex items-center gap-1.5">
            <span className="truncate">{item.label}</span>
            {deltaSymbol && (
              <span
                className={`text-xs font-bold shrink-0 ${deltaClass}`}
                title={deltaLabel ?? undefined}
                aria-label={deltaLabel ?? undefined}
              >
                {deltaSymbol}
              </span>
            )}
          </p>
          <p className="text-xs opacity-90">{item.levelLabel}</p>
        </div>
      </div>
      <div className="text-sm font-semibold shrink-0">
        {showScore && item.score != null ? `${Math.round(item.score)}/100` : fmtValue(item)}
      </div>
    </div>
  );
}

export default function FullReportPanel({ companyId, companyName, onGoToData }: FullReportPanelProps) {
  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod] = useState<string>("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [comparison, setComparison] = useState<ScorecardComparison | null>(null);
  const [savedReportId, setSavedReportId] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // preflight
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [checkingData, setCheckingData] = useState(false);

  // settings
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [draftSector, setDraftSector] = useState("geral");
  const [draftThresholds, setDraftThresholds] = useState<Record<string, Threshold>>({});

  // Load periods
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/companies/${companyId}/periods`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { period: string }[]) => {
        if (cancelled) return;
        const ps = rows.map((r) => r.period);
        setPeriods(ps);
        setPeriod((cur) => cur || ps[0] || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [companyId]);

  // Load latest saved report when period changes
  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    setLoadingSaved(true);
    setReport(null);
     setComparison(null);
    setSavedReportId(null);
    setSavedAt(null);
    fetch(`/api/companies/${companyId}/full-report/latest?period=${encodeURIComponent(period)}`, { credentials: "include" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSavedReportId(data.id ?? null);
        setReport(data.report);
         setComparison(data.comparison ?? null);
        setSavedAt(data.createdAt);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSaved(false); });
    return () => { cancelled = true; };
  }, [companyId, period]);

  const loadSettings = useCallback(async () => {
    const r = await fetch(`/api/companies/${companyId}/report-settings`, { credentials: "include" });
    if (!r.ok) throw new Error(`Erro ${r.status} ao carregar configurações`);
    const s: SettingsData = await r.json();
    setSettings(s);
    setDraftSector(s.sector);
    setDraftThresholds(s.thresholds);
    return s;
  }, [companyId]);

  async function openSettings() {
    try {
      await loadSettings();
      setShowSettings(true);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/report-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sector: draftSector, thresholds: draftThresholds }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error ?? `Erro ${r.status} ao salvar configurações`);
      }
      const s: SettingsData = await r.json();
      setSettings(s);
      setDraftThresholds(s.thresholds);
      setShowSettings(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingSettings(false);
    }
  }

  function onSectorChange(sector: string) {
    setDraftSector(sector);
    // Ao trocar o setor, aplica os benchmarks padrão daquele setor
    // (customizações anteriores são descartadas — o consultor pode reeditar depois).
    const defaults = settings?.sectorDefaults?.[sector];
    if (defaults) setDraftThresholds(defaults);
  }

  async function checkAndMaybeGenerate() {
    if (!period) return;
    setCheckingData(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/companies/${companyId}/full-report/preflight?period=${encodeURIComponent(period)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`Erro ${r.status} ao verificar dados`);
      const p: PreflightData = await r.json();
      if (p.missingCount > 0) {
        setPreflight(p);
        setShowPreflight(true);
      } else {
        await generate();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCheckingData(false);
    }
  }

  async function generate() {
    setShowPreflight(false);
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/full-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ period }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error ?? `Erro ${r.status} ao gerar relatório`);
      }
      const data = await r.json();
      setSavedReportId(data.reportId ?? null);
      setReport(data.report);
      setComparison(data.comparison ?? null);
      setSavedAt(new Date().toISOString());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    if (!savedReportId) return;
    setDownloading(true);
    try {
      const r = await fetch(`/api/reports/${savedReportId}/download`, { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error ?? "Falha ao gerar PDF");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GESAIA_${(companyName ?? "Empresa").replace(/\s+/g, "_")}_Diagnostico_Completo${period ? `_${period}` : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF baixado com sucesso" });
    } catch (e) {
      toast({
        title: "Erro ao baixar PDF",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  const generatedLabel = savedAt
    ? new Date(savedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const previousIndicators = comparison
    ? Object.fromEntries(comparison.scorecard.indicators.map((item) => [item.key, item]))
    : undefined;
  const previousEngines = comparison
    ? Object.fromEntries(comparison.scorecard.engines.map((item) => [item.key, item]))
    : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Relatório Completo de Diagnóstico
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Roda todos os motores de análise, calcula os indicadores e gera uma narrativa acessível ao
            empresário, com scorecard visual priorizado do pior para o melhor.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={openSettings} title="Setor e limiares de avaliação">
            <Settings2 className="w-4 h-4" />
          </Button>
          {report && savedReportId && (
            <Button variant="outline" onClick={downloadPdf} disabled={downloading}>
              {downloading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4 mr-2" />
              )}
              Baixar PDF
            </Button>
          )}
          <Button onClick={checkAndMaybeGenerate} disabled={loading || checkingData || !period}>
            {loading || checkingData ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {checkingData ? "Verificando dados…" : "Gerando relatório…"}
              </>
            ) : report ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Atualizar Relatório
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Gerar Relatório Completo
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Loading saved */}
      {loadingSaved && !report && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Buscando relatório salvo…
        </div>
      )}

      {/* Generating */}
      {loading && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground max-w-sm">
              Executando os 10 motores de análise, calculando indicadores e gerando a narrativa com IA.
              Isso pode levar até um minuto…
            </p>
          </CardContent>
        </Card>
      )}

      {/* Report */}
      {report && !loading && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Período: {report.period}</Badge>
            <Badge variant="secondary">Setor: {SECTOR_LABELS[report.sector] ?? report.sector}</Badge>
            {generatedLabel && <span>Salvo em {generatedLabel}</span>}
          </div>

          {report.aiError && (
            <Card className="border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40">
              <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {report.aiError}
              </CardContent>
            </Card>
          )}

          {report.missingFields.length > 0 && (
            <Card className="border-dashed">
              <CardContent className="p-4 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Dados não informados neste período: </span>
                {report.missingFields.join(", ")}. Cálculos que dependem deles aparecem como "Dados não informados".
                {onGoToData && (
                  <Button variant="link" size="sm" className="h-auto p-0 ml-1 text-xs" onClick={onGoToData}>
                    Preencher na aba Dados <ArrowRight className="w-3 h-3 ml-0.5" />
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="detailed">
            <TabsList>
              <TabsTrigger value="detailed">Detalhado</TabsTrigger>
              <TabsTrigger value="scorecard">Scorecard</TabsTrigger>
            </TabsList>

            {/* ── Modo Detalhado (empresário) ── */}
            <TabsContent value="detailed" className="space-y-4 mt-4">
              {report.narrative ? (
                <>
                  {report.narrative.executiveSummary && (
                    <Card className="border-primary/30 bg-primary/5">
                      <CardContent className="p-5">
                        <p className="text-sm font-semibold mb-1 flex items-center gap-2">
                          <Target className="w-4 h-4 text-primary" /> Resumo Executivo
                        </p>
                        <p className="text-sm leading-relaxed">{report.narrative.executiveSummary}</p>
                      </CardContent>
                    </Card>
                  )}
                  {(report.narrative.sections ?? []).map((s) => (
                    <Card key={s.key}>
                      <CardContent className="p-5 space-y-3">
                        <h4 className="font-semibold text-sm">{s.title}</h4>
                        <p className="text-sm leading-relaxed text-foreground">{s.narrative}</p>
                        {s.causes && s.causes.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                              Causas prováveis
                            </p>
                            <ul className="space-y-1">
                              {s.causes.map((c, i) => (
                                <li key={i} className="text-sm pl-4 relative">
                                  <span className="absolute left-0 text-muted-foreground">•</span>
                                  {c}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {s.suggestions && s.suggestions.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                              Sugestões de melhoria
                            </p>
                            <div className="space-y-2">
                              {s.suggestions.map((sg, i) => (
                                <div key={i} className="flex items-start gap-2 p-2.5 rounded-md bg-muted/50 text-sm">
                                  <Lightbulb className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
                                  <div>
                                    <p className="font-medium">{sg.action}</p>
                                    {sg.expectedImpact && (
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        Impacto esperado: {sg.expectedImpact}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  {report.narrative.nextSteps && (
                    <Card>
                      <CardContent className="p-5">
                        <p className="text-sm font-semibold mb-1 flex items-center gap-2">
                          <ArrowRight className="w-4 h-4 text-primary" /> Próximos Passos
                        </p>
                        <p className="text-sm leading-relaxed">{report.narrative.nextSteps}</p>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    A narrativa detalhada não está disponível neste relatório. Clique em "Atualizar
                    Relatório" para gerá-la novamente.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ── Modo Compacto (Scorecard) ── */}
            <TabsContent value="scorecard" className="space-y-5 mt-4">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>🔴 Crítico</span><span>🟠 Ruim</span><span>🟡 Aceitável</span>
                <span>🟢 Bom</span><span>⭐ Excelente</span><span>⚪ Dados não informados</span>
              </div>
              {comparison ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
                  <span className="font-medium text-foreground">Evolução vs. {comparison.period}:</span>
                  <span className="text-emerald-700 dark:text-emerald-400">▲ melhorou</span>
                  <span className="text-red-700 dark:text-red-400">▼ piorou</span>
                  <span>= sem mudança</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Ainda não há um período anterior com dados para comparar.
                </p>
              )}
              <div>
                <h4 className="text-sm font-semibold mb-2">Indicadores-chave (do pior para o melhor)</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {report.scorecard.indicators.map((i) => (
                    <ScoreRow key={i.key} item={i} previousItems={previousIndicators} />
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">Motores de análise (score 0–100)</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {report.scorecard.engines.map((e) => (
                    <ScoreRow key={e.key} item={e} showScore previousItems={previousEngines} />
                  ))}
                </div>
              </div>
              {report.blufRecommendation && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="p-4 text-sm">
                    <p className="font-semibold mb-1">Recomendação prioritária</p>
                    {report.blufRecommendation}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Empty state */}
      {!report && !loading && !loadingSaved && (
        <Card className="border-dashed">
          <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground max-w-md">
              {periods.length === 0
                ? "Nenhum período com dados cadastrados. Cadastre dados na aba Dados para gerar o relatório."
                : <>Selecione o período e clique em <strong>Gerar Relatório Completo</strong>. O relatório é salvo e fica vinculado ao período — você pode atualizá-lo após cadastrar novos dados.</>}
            </p>
            {periods.length === 0 && onGoToData && (
              <Button variant="outline" size="sm" onClick={onGoToData}>
                Ir para aba Dados <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Preflight: checklist de dados faltantes ── */}
      <Dialog open={showPreflight} onOpenChange={setShowPreflight}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-primary" /> Dados do período {period}
            </DialogTitle>
            <DialogDescription>
              {preflight?.missingCount} de {preflight?.totalCount} campos não estão preenchidos. Você pode
              completá-los na aba Dados ou continuar — cálculos incompletos aparecerão como "Dados não informados".
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-y-auto space-y-4 pr-1">
            {preflight?.checklist.map((g) => (
              <div key={g.group}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{g.group}</p>
                <div className="space-y-1">
                  {g.fields.map((f) => (
                    <div key={f.key} className="flex items-center gap-2 text-sm">
                      {f.filled ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <span className={f.filled ? "" : "text-muted-foreground"}>{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {onGoToData && (
              <Button
                variant="outline"
                onClick={() => { setShowPreflight(false); onGoToData(); }}
              >
                Preencher na aba Dados
              </Button>
            )}
            <Button onClick={generate}>
              Continuar mesmo assim
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Settings: setor + limiares ── */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" /> Setor e limiares de avaliação
            </DialogTitle>
            <DialogDescription>
              Os benchmarks se ajustam ao segmento da empresa e podem ser editados a qualquer momento.
              As faixas definem: Crítico → Ruim → Aceitável → Bom → Excelente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium w-40">Setor da empresa</p>
              <Select value={draftSector} onValueChange={onSectorChange}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(settings?.sectorOptions ?? ["geral"]).map((s) => (
                    <SelectItem key={s} value={s}>{SECTOR_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-[45vh] overflow-y-auto space-y-3 pr-1">
              {(settings?.indicatorDefs ?? []).map((def) => {
                const t = draftThresholds[def.key];
                if (!t) return null;
                return (
                  <div key={def.key} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium">{def.label} <span className="text-muted-foreground">({def.unit})</span></p>
                      <Badge variant="outline" className="text-xs">
                        {t.direction === "higher" ? "maior é melhor" : "menor é melhor"}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {t.bounds.map((b, i) => (
                        <div key={i}>
                          <p className="text-[10px] text-muted-foreground mb-0.5">
                            {["Crítico até", "Ruim até", "Aceitável até", "Bom até"][t.direction === "higher" ? i : i]}
                          </p>
                          <Input
                            type="number"
                            step="any"
                            value={b}
                            className="h-8 text-sm"
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setDraftThresholds((prev) => {
                                const cur = prev[def.key];
                                const bounds = [...cur.bounds] as Threshold["bounds"];
                                bounds[i] = isNaN(v) ? 0 : v;
                                return { ...prev, [def.key]: { ...cur, bounds } };
                              });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>Cancelar</Button>
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar configurações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
