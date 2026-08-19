import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listPeriods,
  getListPeriodsQueryKey,
  useUpsertCompanyData,
} from "@workspace/api-client-react";
import {
  Plus,
  Database,
  Save,
  Loader2,
  Upload,
  Download,
  FileSpreadsheet,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  hydrateAdditionalData,
} from "./riskPersistence";
import { buildDataEntryPayload } from "./dataEntryPayload";
import { deriveFinancialValues } from "./financialDerivations";
import {
  AD_CSV_COLUMNS,
  CSV_COLUMNS,
  buildCsvImportMapping,
  buildCsvTemplateRows,
  buildImportRows,
  parseCsv,
  type ParsedRow,
} from "./csvImport";
import {
  resolveDataEntryHighlightFields,
  type DataEntryGroup,
  type DataEntryNavigationTarget,
} from "./dataEntryNavigation";

/* ── Read-only calculated field display ──────────────────────────────── */
function CalcField({ label, value, note, cls }: { label: string; value: string; note?: string; cls: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1.5">
        {label}
        <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-tight">calculado</Badge>
      </Label>
      <div className={`flex items-center h-9 px-3 rounded-md border text-sm font-medium ${cls}`}>
        {value}
      </div>
      {note && <p className="text-[10px] text-muted-foreground leading-tight">{note}</p>}
    </div>
  );
}

/* ── Field definitions ───────────────────────────────────────────────── */
const FIELDS = [
  { key: "grossRevenue",            label: "Receita Bruta (R$)" },
  { key: "deductions",              label: "Deduções da Receita (R$)" },
  { key: "netRevenue",              label: "Receita Líquida (R$)" },
  { key: "cogs",                    label: "CMV/CPV (R$)" },
  { key: "grossProfit",             label: "Lucro Bruto (R$)" },
  { key: "fixedCosts",              label: "Custos Fixos (R$)" },
  { key: "variableCosts",           label: "Custos Variáveis (R$)" },
  { key: "depreciationAmortization",label: "D&A — Depreciação e Amortização (R$)" },
  { key: "ebitda",                  label: "EBITDA (R$)" },
  { key: "financialExpenses",       label: "Despesas Financeiras (R$)" },
  { key: "incomeTax",               label: "IR + CSLL (R$)" },
  { key: "netProfit",               label: "Lucro Líquido (R$)" },
  { key: "cashFlow",                label: "Fluxo de Caixa (R$)" },
  { key: "totalEmployees",          label: "Total de Colaboradores" },
  { key: "activeCustomers",         label: "Clientes Ativos" },
  { key: "averageTicket",           label: "Ticket Médio (R$)" },
  { key: "conversionRate",          label: "Taxa de Conversão (%)" },
  { key: "churnRate",               label: "Taxa de Churn (%)" },
  { key: "nps",                     label: "NPS (pts)" },
  { key: "defaultRate",             label: "Inadimplência (%)" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

/* ── CSV template download ───────────────────────────────────────────── */
function downloadTemplate() {
  const { headers, example } = buildCsvTemplateRows();

  // BOM for Excel to detect UTF-8 correctly
  const bom = "\uFEFF";
  const csv = bom + [headers.join(";"), example.join(";")].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "GESAIA_modelo_dados_financeiros.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Import dialog ───────────────────────────────────────────────────── */
interface ImportDialogProps {
  companyId: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ImportDialog({ companyId, open, onClose, onSuccess }: ImportDialogProps) {
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setParsed(null);
    setParseErrors([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows, errors } = parseCsv(text);
      setParsed(rows);
      setParseErrors(errors);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = async () => {
    if (!parsed || parsed.length === 0) return;
    setImporting(true);

    const rows = buildImportRows(parsed);
    const mapping = buildCsvImportMapping();

    try {
      const res = await fetch(`/api/companies/${companyId}/data/import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, mapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro na importação");

      toast({
        title: `${data.imported} período${data.imported !== 1 ? "s" : ""} importado${data.imported !== 1 ? "s" : ""} com sucesso`,
        description: data.warnings?.length ? data.warnings.join(" · ") : undefined,
      });
      onSuccess();
      onClose();
      reset();
    } catch (e: any) {
      toast({ title: "Erro ao importar", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Importar Dados via CSV
          </DialogTitle>
          <DialogDescription>
            Baixe o modelo, preencha com os dados financeiros da empresa e faça o upload.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Step 1: Download template */}
          <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30">
            <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold flex-shrink-0">1</div>
            <div className="flex-1">
              <p className="font-medium text-foreground text-sm">Baixar o modelo</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Arquivo CSV com todas as colunas necessárias e uma linha de exemplo.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-2"
                onClick={downloadTemplate}
              >
                <Download className="w-4 h-4" />
                Baixar modelo CSV
              </Button>
            </div>
          </div>

          {/* Step 2: Upload */}
          <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30">
            <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold flex-shrink-0">2</div>
            <div className="flex-1">
              <p className="font-medium text-foreground text-sm">Preencher e fazer upload</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Selecione o arquivo CSV preenchido. Você pode incluir vários períodos.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                  Selecionar arquivo
                </Button>
                {fileName && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <FileSpreadsheet className="w-4 h-4 text-primary" />
                    <span className="truncate max-w-[200px]">{fileName}</span>
                    <button onClick={reset} className="hover:text-destructive transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFile}
              />
            </div>
          </div>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-700 p-3 space-y-1">
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Avisos ao processar o arquivo
              </p>
              {parseErrors.map((e, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">{e}</p>
              ))}
            </div>
          )}

          {/* Preview */}
          {parsed && parsed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-medium text-foreground">
                  {parsed.length} período{parsed.length !== 1 ? "s" : ""} identificado{parsed.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Período</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Receita Bruta</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rec. Líquida</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">EBITDA</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Luc. Líquido</th>
                      <th className="text-center px-3 py-2 font-medium text-muted-foreground">Campos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((row, i) => {
                      const filledCount = FIELDS.filter((f) => row[f.key] !== undefined).length;
                      const fmt = (v?: string) =>
                        v ? `R$ ${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : "—";
                      return (
                        <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                          <td className="px-3 py-2 font-semibold text-foreground">{row.period}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{fmt(row.grossRevenue)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{fmt(row.netRevenue)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{fmt(row.ebitda)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{fmt(row.netProfit)}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="secondary" className="text-xs">{filledCount}/16</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {parsed && parsed.length === 0 && !parseErrors.some((e) => e.includes("não encontrada")) && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">Nenhum período válido encontrado no arquivo. Verifique o conteúdo e tente novamente.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); reset(); }}>
            Cancelar
          </Button>
          <Button
            disabled={!parsed || parsed.length === 0 || importing}
            onClick={handleImport}
          >
            {importing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Importar {parsed && parsed.length > 0 ? `${parsed.length} período${parsed.length !== 1 ? "s" : ""}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main panel ──────────────────────────────────────────────────────── */
interface DataEntryPanelProps {
  companyId: number;
  navigationTarget?: DataEntryNavigationTarget | null;
  onNavigationHandled?: () => void;
}

// All numeric keys that live on the top-level companyData row (not in additionalData)
const MAIN_FORM_KEYS = [
  "grossRevenue","deductions","netRevenue","cogs","grossProfit",
  "fixedCosts","variableCosts","depreciationAmortization","ebitda",
  "financialExpenses","incomeTax","netProfit","cashFlow",
  "totalEmployees","activeCustomers","averageTicket",
  "conversionRate","churnRate","nps","defaultRate",
  "pmr","pmp","pme","proLabore",
] as const;

export default function DataEntryPanel({
  companyId,
  navigationTarget,
  onNavigationHandled,
}: DataEntryPanelProps) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  // Set to true when loading an existing period's data failed — Save is blocked
  // until load succeeds or the dialog is closed, preventing accidental data erasure.
  const [loadError, setLoadError] = useState(false);
  // True when the dialog is editing an existing server-side period (vs. creating new).
  const [isExistingPeriod, setIsExistingPeriod] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ period: "" });
  // Full additionalData object loaded from the server when editing an existing period.
  // Used as the merge base so unknown engine keys (marketing, operations, HR, risks …)
  // are never silently discarded on save.
  const [baseAdditionalData, setBaseAdditionalData] = useState<Record<string, unknown>>({});
  const [navigationHighlight, setNavigationHighlight] = useState<DataEntryNavigationTarget | null>(null);
  const groupRefs = useRef<Partial<Record<DataEntryGroup, HTMLDivElement | null>>>({});

  // AbortController for the current in-flight period-load request.
  // Cancelling it prevents a stale response from a previous/closed dialog from
  // overwriting the active form or merge base.
  const loadAbortRef = useRef<AbortController | null>(null);

  const { data: periods = [], isLoading } = useQuery({
    queryKey: getListPeriodsQueryKey(companyId),
    queryFn: () => listPeriods(companyId),
  });

  // Abort any in-flight load and reset dialog state — call when closing the dialog.
  const cancelLoad = () => {
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    setLoadingPeriod(false);
    setLoadError(false);
  };

  // Fetch existing period data and pre-populate the form so that saving never
  // silently discards previously stored values (including additionalData engine fields).
  // Cancels any prior in-flight request so a stale response can never overwrite
  // the active form. If the load fails, `loadError` is set and Save is blocked.
  const loadPeriodData = async (period: string) => {
    // Abort any existing in-flight load to prevent stale results
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    setLoadingPeriod(true);
    setLoadError(false);
    setBaseAdditionalData({});
    try {
      const res = await fetch(
        `/api/companies/${companyId}/data?period=${encodeURIComponent(period)}`,
        { credentials: "include", signal: controller.signal }
      );
      if (!res.ok) {
        if (!controller.signal.aborted) setLoadError(true);
        return;
      }
      const rows: any[] = await res.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) {
        const populated: Record<string, string> = { period };
        for (const key of MAIN_FORM_KEYS) {
          if (row[key] != null && row[key] !== "") populated[key] = String(row[key]);
        }
        // Load the full additionalData object as the merge base; also hydrate ad_* form fields
        const existingAd = (row.additionalData && typeof row.additionalData === "object")
          ? (row.additionalData as Record<string, unknown>)
          : {};
        setBaseAdditionalData(existingAd);
        Object.assign(populated, hydrateAdditionalData(existingAd));
        setForm(populated);
      }
    } catch (e: any) {
      // AbortError means this request was intentionally cancelled (dialog closed /
      // new period opened) — do not treat it as a user-visible error.
      if (e?.name !== "AbortError") setLoadError(true);
    } finally {
      // Only clear the loading indicator when this controller is still active
      if (loadAbortRef.current === controller) setLoadingPeriod(false);
    }
  };

  const openEditPeriod = (period: string) => {
    setIsExistingPeriod(true);
    setShowForm(true);
    setForm({ period });
    loadPeriodData(period);
  };

  // A request from the analysis tab opens the exact period that generated the
  // warning, rather than defaulting to the most recent data-entry period.
  useEffect(() => {
    if (!navigationTarget) return;

    cancelLoad();
    setNavigationHighlight(navigationTarget);
    setShowForm(true);
    setForm({ period: navigationTarget.period });
    setBaseAdditionalData({});

    const hasExistingPeriod = periods.some((item) => item.period === navigationTarget.period);
    setIsExistingPeriod(hasExistingPeriod);
    if (hasExistingPeriod) void loadPeriodData(navigationTarget.period);

    onNavigationHandled?.();
    // The target is deliberately consumed once. Re-running for a query refresh
    // would reopen a dialog the consultant has already dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationTarget]);

  // Keep the visual cue brief so it guides the consultant without making the
  // form look persistently invalid.
  useEffect(() => {
    if (!navigationHighlight) return;
    const timeout = window.setTimeout(() => setNavigationHighlight(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [navigationHighlight]);

  useEffect(() => {
    if (!navigationHighlight || !showForm || loadingPeriod) return;
    const frame = window.requestAnimationFrame(() => {
      groupRefs.current[navigationHighlight.group]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationHighlight, showForm, loadingPeriod]);

  const highlightedFieldKeys = new Set(
    resolveDataEntryHighlightFields(navigationHighlight?.fields ?? []),
  );
  const groupClass = (group: DataEntryGroup) =>
    `space-y-2 rounded-lg transition-all duration-300 ${
      navigationHighlight?.group === group
        ? "bg-primary/5 p-3 ring-2 ring-primary/30 shadow-sm"
        : ""
    }`;
  const fieldClass = (fieldKey: string) =>
    `space-y-1 rounded-md transition-colors duration-300 ${
      highlightedFieldKeys.has(fieldKey)
        ? "bg-amber-100/80 p-2 ring-1 ring-amber-400/70 dark:bg-amber-950/40 dark:ring-amber-600/70"
        : ""
    }`;

  const upsertMut = useUpsertCompanyData({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPeriodsQueryKey(companyId) });
        qc.invalidateQueries({ queryKey: ["company-dashboard", companyId] });
        qc.invalidateQueries({ queryKey: ["kpi-history", companyId] });
        // #19 — invalidate period meta so AnalysisPanel picks up the stale signal immediately
        qc.invalidateQueries({ queryKey: ["company-period-meta", companyId] });
        qc.invalidateQueries({ queryKey: ["analysis-latest", companyId] });
        setShowForm(false);
        setForm({ period: "" });
        toast({ title: "Dados salvos com sucesso" });
      },
      onError: () => toast({ title: "Erro ao salvar dados", variant: "destructive" }),
    },
  });

  const handleImportSuccess = () => {
    qc.invalidateQueries({ queryKey: getListPeriodsQueryKey(companyId) });
    qc.invalidateQueries({ queryKey: ["company-dashboard", companyId] });
    qc.invalidateQueries({ queryKey: ["kpi-history", companyId] });
    // #19 — invalidate period meta so AnalysisPanel picks up the stale signal immediately
    qc.invalidateQueries({ queryKey: ["company-period-meta", companyId] });
    qc.invalidateQueries({ queryKey: ["analysis-latest", companyId] });
  };

  // Derived / calculated values (read-only, updated in real-time)
  const derived = (() => {
    const grossRev = parseFloat(form.grossRevenue ?? "");
    const ded      = parseFloat(form.deductions   ?? "");

    const cogs  = parseFloat(form.cogs          ?? "");
    const fx    = parseFloat(form.fixedCosts    ?? "");
    const vr    = parseFloat(form.variableCosts ?? "");
    const da    = parseFloat(form.depreciationAmortization ?? ""); // D&A (dentro dos Custos Fixos)
    const finExp = parseFloat(form.financialExpenses ?? "");
    const tax   = parseFloat(form.incomeTax     ?? "");

    const { netIsAuto, net, grossProfit, ebit, ebitda } = deriveFinancialValues({
      grossRevenue: grossRev,
      deductions: ded,
      netRevenue: parseFloat(form.netRevenue ?? ""),
      cogs,
      fixedCosts: fx,
      variableCosts: vr,
      depreciationAmortization: da,
    });
    const mc          = (!isNaN(net) && !isNaN(vr))   ? net - vr   : NaN;
    const mcPct       = (!isNaN(mc)  && !isNaN(net) && net > 0) ? (mc / net) * 100 : NaN;

    // LAIR = EBIT − Despesas Financeiras
    const lair = !isNaN(ebit) && !isNaN(finExp) ? ebit - finExp : NaN;

    // Lucro Líquido automático somente quando a cadeia completa está disponível
    const netProfitIsAuto = !isNaN(lair) && !isNaN(tax);
    const netProfitCalc   = netProfitIsAuto ? lair - tax : NaN;

    const breakEven    = (!isNaN(mc) && !isNaN(fx) && !isNaN(net) && mc > 0) ? fx / (mc / net) : NaN;
    const safetyMargin = (!isNaN(breakEven) && !isNaN(net) && net > 0) ? ((net - breakEven) / net) * 100 : NaN;

    // Ciclo financeiro
    const pmr = parseFloat(form.pmr ?? "");
    const pmp = parseFloat(form.pmp ?? "");
    const pme = parseFloat(form.pme ?? "");
    const operatingCycle = (!isNaN(pmr) && !isNaN(pme)) ? pmr + pme : NaN;
    const cashCycle      = (!isNaN(operatingCycle) && !isNaN(pmp)) ? operatingCycle - pmp : NaN;
    const workingCapNeed = (!isNaN(cashCycle) && !isNaN(net) && net > 0)
      ? Math.round(cashCycle * (net / 30)) : NaN;

    return {
      net, netIsAuto,
      grossProfit, mc, mcPct,
      ebit, ebitda, lair,
      netProfitCalc, netProfitIsAuto,
      breakEven, safetyMargin,
      operatingCycle, cashCycle, workingCapNeed,
    };
  })();

  const fmtBRL = (v: number) =>
    isNaN(v) ? "—" : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  const fmtPct = (v: number) =>
    isNaN(v) ? "—" : `${v.toFixed(1)}%`;
  const fmtDays = (v: number) =>
    isNaN(v) ? "—" : `${Math.round(v)} dias`;

  const safetyClass = (v: number) => {
    if (isNaN(v)) return "border-border bg-muted/50 text-muted-foreground";
    if (v < 0)    return "border-destructive/30 bg-destructive/5 text-destructive";
    if (v < 10)   return "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-900/10 dark:text-orange-400";
    if (v < 20)   return "border-yellow-200 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/10 dark:text-yellow-400";
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400";
  };
  const numClass = (v: number) =>
    isNaN(v) ? "border-border bg-muted/50 text-muted-foreground"
    : v >= 0  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400"
    :           "border-destructive/30 bg-destructive/5 text-destructive";

  const handleSubmit = () => {
    if (!form.period) return;
    // Defensive guard: never save over an existing period if its data failed to load —
    // the merge base would be empty and we would erase all stored engine values.
    if (isExistingPeriod && loadError) return;
    const body = buildDataEntryPayload(form, derived, baseAdditionalData);
    if (!body) {
      toast({
        title: "Revise os dados antes de salvar",
        description: "Informe um período válido e valores numéricos finitos.",
        variant: "destructive",
      });
      return;
    }

    upsertMut.mutate({ id: companyId, data: body });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          Dados Financeiros por Período
        </h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowImport(true)}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Importar CSV
          </Button>
          <Button size="sm" onClick={() => { cancelLoad(); setForm({ period: "" }); setBaseAdditionalData({}); setIsExistingPeriod(false); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1.5" />
            Inserir Dados
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : periods.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Database className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">Nenhum dado inserido</p>
            <p className="text-sm text-muted-foreground mt-1">
              Insira dados manualmente ou importe um arquivo CSV
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Upload className="w-4 h-4 mr-1.5" />
                Importar CSV
              </Button>
              <Button size="sm" onClick={() => { cancelLoad(); setForm({ period: "" }); setBaseAdditionalData({}); setIsExistingPeriod(false); setShowForm(true); }}>
                <Plus className="w-4 h-4 mr-1.5" />
                Inserir Dados
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {periods.map((p) => (
            <Card
              key={p.period}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => openEditPeriod(p.period)}
            >
              <CardContent className="p-3 text-center">
                <p className="font-semibold text-foreground">{p.period}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Com dados</p>
                {p.needsReanalysis && (
                  <Badge
                    className="mt-2 gap-1 bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/40"
                    title="Os dados foram alterados após a última análise."
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Análise desatualizada
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Manual entry dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { cancelLoad(); setShowForm(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Inserir / Atualizar Dados Financeiros</DialogTitle>
          </DialogHeader>
          {loadingPeriod ? (
            <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Carregando dados do período…</span>
            </div>
          ) : loadError && isExistingPeriod ? (
            <div className="py-8 space-y-4 text-center">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 mx-1">
                <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
                <p className="text-sm font-medium text-destructive">Não foi possível carregar os dados deste período</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Salvar agora poderia apagar informações existentes. Tente novamente antes de continuar.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 gap-2"
                  onClick={() => loadPeriodData(form.period)}
                >
                  <Loader2 className="w-3.5 h-3.5" />
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : (
          <div className="space-y-5 py-2">

            {/* Período */}
            <div className="space-y-1.5">
              <Label>Período *</Label>
              <Input
                placeholder="Ex: 2024-01, 2024-Q1, 2024"
                value={form.period}
                onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
              />
            </div>

            {/* Receitas */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receitas</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Receita Bruta (R$)</Label>
                  <Input type="number" placeholder="—" value={form.grossRevenue ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, grossRevenue: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Deduções da Receita (R$)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" placeholder="Impostos s/ venda, devoluções…"
                    value={form.deductions ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, deductions: e.target.value }))} />
                </div>
                {/* Receita Líquida: automática quando Bruta + Deduções preenchidas, manual caso contrário */}
                {derived.netIsAuto ? (
                  <CalcField
                    label="Receita Líquida (R$)"
                    value={fmtBRL(derived.net)}
                    note="Receita Bruta − Deduções"
                    cls={numClass(derived.net)} />
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs">Receita Líquida (R$)
                      <span className="ml-1 text-muted-foreground font-normal">ou informe Deduções para calcular</span>
                    </Label>
                    <Input type="number" placeholder="—" value={form.netRevenue ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, netRevenue: e.target.value }))} />
                  </div>
                )}
              </div>
            </div>

            {/* Custos e DRE */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Custos e DRE</p>
              <div className="grid grid-cols-2 gap-3">

                {/* CMV → Lucro Bruto */}
                <div className="space-y-1">
                  <Label className="text-xs">CMV / CPV (R$)</Label>
                  <Input type="number" placeholder="—" value={form.cogs ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, cogs: e.target.value }))} />
                </div>
                <CalcField label="Lucro Bruto (R$)" value={fmtBRL(derived.grossProfit)}
                  note="Receita Líquida − CMV" cls={numClass(derived.grossProfit)} />

                {/* Variáveis → MC */}
                <div className="space-y-1">
                  <Label className="text-xs">Custos Variáveis (R$)</Label>
                  <Input type="number" placeholder="—" value={form.variableCosts ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, variableCosts: e.target.value }))} />
                </div>
                <CalcField label="Margem de Contribuição" value={`${fmtBRL(derived.mc)}  (${fmtPct(derived.mcPct)})`}
                  note="Receita Líquida − Custos Variáveis" cls={numClass(derived.mc)} />

                {/* Fixos → EBIT */}
                <div className="space-y-1">
                  <Label className="text-xs">Custos Fixos (R$)
                    <span className="ml-1 text-muted-foreground font-normal">— inclui D&A</span>
                  </Label>
                  <Input type="number" placeholder="—" value={form.fixedCosts ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, fixedCosts: e.target.value }))} />
                </div>
                <CalcField label="Resultado Operacional / EBIT (R$)" value={fmtBRL(derived.ebit)}
                  note="Lucro Bruto − Fixos − Variáveis" cls={numClass(derived.ebit)} />

                {/* D&A → EBITDA */}
                <div className="space-y-1">
                  <Label className="text-xs">D&A — Depreciação e Amortização (R$)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional, já inclusa nos Fixos</span>
                  </Label>
                  <Input type="number" placeholder="—" value={form.depreciationAmortization ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, depreciationAmortization: e.target.value }))} />
                </div>
                <CalcField label="EBITDA (R$)" value={fmtBRL(derived.ebitda)}
                  note={!isNaN(parseFloat(form.depreciationAmortization ?? ""))
                    ? "EBIT + D&A (add-back correto)"
                    : "EBIT (informe D&A para EBITDA correto)"}
                  cls={numClass(derived.ebitda)} />

                {/* PE e Margem de Segurança */}
                <CalcField label="Ponto de Equilíbrio (R$)" value={fmtBRL(derived.breakEven)}
                  note="Custos Fixos ÷ MC%" cls={numClass(isNaN(derived.breakEven) ? NaN : 1)} />
                <CalcField label="Margem de Segurança" value={fmtPct(derived.safetyMargin)}
                  note={isNaN(derived.safetyMargin) ? "" :
                    derived.safetyMargin < 0 ? "Péssimo" : derived.safetyMargin < 10 ? "Ruim" :
                    derived.safetyMargin < 20 ? "Aceitável" : derived.safetyMargin < 35 ? "Bom" : "Excelente"}
                  cls={safetyClass(derived.safetyMargin)} />

                {/* Despesas Financeiras → LAIR */}
                <div className="space-y-1">
                  <Label className="text-xs">Despesas Financeiras (R$)
                    <span className="ml-1 text-muted-foreground font-normal">— juros, IOF, tarifas</span>
                  </Label>
                  <Input type="number" placeholder="—" value={form.financialExpenses ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, financialExpenses: e.target.value }))} />
                </div>
                <CalcField label="LAIR — Lucro Antes do IR (R$)" value={fmtBRL(derived.lair)}
                  note="EBIT − Despesas Financeiras" cls={numClass(derived.lair)} />

                {/* IR/CSLL → Lucro Líquido */}
                <div className="space-y-1">
                  <Label className="text-xs">IR + CSLL (R$)</Label>
                  <Input type="number" placeholder="—" value={form.incomeTax ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, incomeTax: e.target.value }))} />
                </div>
                {derived.netProfitIsAuto ? (
                  <CalcField label="Lucro Líquido (R$)" value={fmtBRL(derived.netProfitCalc)}
                    note="LAIR − IR/CSLL" cls={numClass(derived.netProfitCalc)} />
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs">Lucro Líquido (R$)</Label>
                    <Input type="number" placeholder="—" value={form.netProfit ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, netProfit: e.target.value }))} />
                    <p className="text-[10px] text-muted-foreground">
                      {!isNaN(derived.ebit)
                        ? "Informe Despesas Financeiras e IR+CSLL para cálculo automático"
                        : "Calculado automaticamente quando EBIT, Desp. Financeiras e IR+CSLL disponíveis"}
                    </p>
                  </div>
                )}

                {/* Fluxo de Caixa */}
                <div className="space-y-1">
                  <Label className="text-xs">Fluxo de Caixa (R$)</Label>
                  <Input type="number" placeholder="—" value={form.cashFlow ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, cashFlow: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Ciclo Financeiro */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ciclo Financeiro (dias)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">PMR — Prazo Médio de Recebimento</Label>
                  <Input type="number" placeholder="Ex: 30" value={form.pmr ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, pmr: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PMP — Prazo Médio de Pagamento</Label>
                  <Input type="number" placeholder="Ex: 45" value={form.pmp ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, pmp: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PME — Prazo Médio de Estoque</Label>
                  <Input type="number" placeholder="Ex: 15" value={form.pme ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, pme: e.target.value }))} />
                </div>
                <CalcField label="Ciclo de Caixa (dias)" value={fmtDays(derived.cashCycle)}
                  note="PME + PMR − PMP"
                  cls={isNaN(derived.cashCycle) ? "border-border bg-muted/50 text-muted-foreground"
                    : derived.cashCycle <= 15 ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400"
                    : derived.cashCycle <= 30 ? "border-yellow-200 bg-yellow-50 text-yellow-700"
                    : "border-destructive/30 bg-destructive/5 text-destructive"} />
                {!isNaN(derived.workingCapNeed) && (
                  <CalcField label="Necessidade de Cap. de Giro" value={fmtBRL(derived.workingCapNeed)}
                    note="Ciclo de Caixa × (Rec. Líq. / 30)" cls={numClass(isNaN(derived.workingCapNeed) ? NaN : 1)} />
                )}
              </div>
            </div>

            {/* Gestão */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gestão &amp; Pró-labore</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Pró-labore dos Sócios (R$)</Label>
                  <Input type="number" placeholder="—" value={form.proLabore ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, proLabore: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Operacional & Clientes */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Operacional &amp; Clientes</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "totalEmployees",  label: "Total de Colaboradores" },
                  { key: "activeCustomers", label: "Clientes Ativos" },
                  { key: "nps",             label: "NPS (pts)" },
                  { key: "defaultRate",     label: "Inadimplência (%)" },
                ].map(({ key, label }) => (
                  <div key={key} className={fieldClass(key)}>
                    <Label className="text-xs">{label}</Label>
                    <Input type="number" placeholder="—" value={form[key] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>

            {/* Motor Comercial */}
            <div
              ref={(node) => { groupRefs.current.commercial = node; }}
              className={groupClass("commercial")}
            >
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comercial — CAC, LTV/CAC e Funil</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Dados para calcular CAC, LTV/CAC e taxas de conversão do funil comercial.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className={fieldClass("ad_newCustomers")}>
                  <Label className="text-xs">Novos clientes no período</Label>
                  <Input type="number" placeholder="Ex: 12" value={form["ad_newCustomers"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_newCustomers: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_totalAcquisitionCost")}>
                  <Label className="text-xs">Custo total de aquisição (R$)
                    <span className="ml-1 text-muted-foreground font-normal">— marketing + vendas</span>
                  </Label>
                  <Input type="number" placeholder="Ex: 8000" value={form["ad_totalAcquisitionCost"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_totalAcquisitionCost: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Número de vendedores ativos</Label>
                  <Input type="number" placeholder="Ex: 3" value={form["ad_numSalespeople"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_numSalespeople: e.target.value }))} />
                </div>
                <div className={fieldClass("averageTicket")}>
                  <Label className="text-xs">Ticket Médio (R$)</Label>
                  <Input type="number" placeholder="—" value={form.averageTicket ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, averageTicket: e.target.value }))} />
                </div>
                <div className={fieldClass("conversionRate")}>
                  <Label className="text-xs">Taxa de Conversão (%)</Label>
                  <Input type="number" placeholder="—" value={form.conversionRate ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, conversionRate: e.target.value }))} />
                </div>
                <div className={fieldClass("churnRate")}>
                  <Label className="text-xs">Taxa de Churn (%)</Label>
                  <Input type="number" placeholder="—" value={form.churnRate ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, churnRate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Leads gerados no período</Label>
                  <Input type="number" placeholder="Ex: 120" value={form["ad_funnelLeads"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_funnelLeads: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Propostas enviadas</Label>
                  <Input type="number" placeholder="Ex: 40" value={form["ad_funnelProposals"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_funnelProposals: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Negociações abertas</Label>
                  <Input type="number" placeholder="Ex: 20" value={form["ad_funnelNegotiations"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_funnelNegotiations: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Motor de Marketing */}
            <div
              ref={(node) => { groupRefs.current.marketing = node; }}
              className={groupClass("marketing")}
            >
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Marketing — CTR, CPL, ROAS e ROI</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Dados de mídia paga/digital para calcular CTR, CPL, ROAS, ROI e LTV/CAC.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className={fieldClass("ad_impressions")}>
                  <Label className="text-xs">Impressões de anúncios</Label>
                  <Input type="number" placeholder="Ex: 50000" value={form["ad_impressions"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_impressions: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_clicks")}>
                  <Label className="text-xs">Cliques nos anúncios</Label>
                  <Input type="number" placeholder="Ex: 1500" value={form["ad_clicks"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_clicks: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_adLeads")}>
                  <Label className="text-xs">Leads gerados pelos anúncios</Label>
                  <Input type="number" placeholder="Ex: 120" value={form["ad_adLeads"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_adLeads: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_adSpend")}>
                  <Label className="text-xs">Investimento em mídia — Ad Spend (R$)</Label>
                  <Input type="number" placeholder="Ex: 5000" value={form["ad_adSpend"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_adSpend: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_adRevenue")}>
                  <Label className="text-xs">Receita atribuída aos anúncios (R$)</Label>
                  <Input type="number" placeholder="Ex: 25000" value={form["ad_adRevenue"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_adRevenue: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Motor de Operações */}
            <div
              ref={(node) => { groupRefs.current.operations = node; }}
              className={groupClass("operations")}
            >
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Operações — OEE e Capacidade</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Dados para calcular OEE, utilização de capacidade e identificação de gargalos.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Utilização da capacidade instalada (%)</Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 75" value={form["ad_capacityUtilization"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_capacityUtilization: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Taxa de defeitos / retrabalho (%)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 3" value={form["ad_defectRate"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_defectRate: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_oeeAvailability")}>
                  <Label className="text-xs">OEE — Disponibilidade (%)
                    <span className="ml-1 text-muted-foreground font-normal">— tempo útil / tempo disponível</span>
                  </Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 90" value={form["ad_oeeAvailability"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_oeeAvailability: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_oeePerformance")}>
                  <Label className="text-xs">OEE — Performance (%)
                    <span className="ml-1 text-muted-foreground font-normal">— velocidade real / velocidade ideal</span>
                  </Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 85" value={form["ad_oeePerformance"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_oeePerformance: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_oeeQuality")}>
                  <Label className="text-xs">OEE — Qualidade (%)
                    <span className="ml-1 text-muted-foreground font-normal">— unidades boas / unidades produzidas</span>
                  </Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 97" value={form["ad_oeeQuality"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_oeeQuality: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tempo médio de ciclo (minutos)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" placeholder="Ex: 15" value={form["ad_avgCycleTimeMins"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_avgCycleTimeMins: e.target.value }))} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Gargalo de processo — informe a capacidade de até 5 etapas para identificar o gargalo:
              </p>
              <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
                {([1, 2, 3, 4, 5] as const).map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Nome — Etapa {i}</Label>
                      <Input
                        type="text"
                        placeholder={`Etapa ${i}`}
                        value={form[`ad_stageName${i}`] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [`ad_stageName${i}`]: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Capacidade</Label>
                      <Input
                        type="number"
                        placeholder="Ex: 100 un/h"
                        value={form[`ad_stageCap${i}`] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [`ad_stageCap${i}`]: e.target.value }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Motor de RH */}
            <div
              ref={(node) => { groupRefs.current.hr = node; }}
              className={groupClass("hr")}
            >
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">RH — Turnover e ROI de Treinamento</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Dados para calcular custo de turnover, taxa de retenção e ROI do programa de treinamento.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Taxa de turnover anual (%)</Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 15" value={form["ad_turnoverRate"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_turnoverRate: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_avgSalary")}>
                  <Label className="text-xs">Salário médio mensal (R$)</Label>
                  <Input type="number" placeholder="Ex: 3500" value={form["ad_avgSalary"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_avgSalary: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Custo médio de recrutamento por vaga (R$)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" placeholder="Ex: 4000" value={form["ad_avgRecruitmentCost"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_avgRecruitmentCost: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Novas contratações no período</Label>
                  <Input type="number" placeholder="Ex: 5" value={form["ad_newHires"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_newHires: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_trainingInvestment")}>
                  <Label className="text-xs">Investimento em treinamento (R$)</Label>
                  <Input type="number" placeholder="Ex: 12000" value={form["ad_trainingInvestment"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_trainingInvestment: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_trainingHoursPerYear")}>
                  <Label className="text-xs">Horas de treinamento por ano</Label>
                  <Input type="number" placeholder="Ex: 40" value={form["ad_trainingHoursPerYear"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_trainingHoursPerYear: e.target.value }))} />
                </div>
                <div className={fieldClass("ad_productivityGainPct")}>
                  <Label className="text-xs">Ganho de produtividade esperado com treinamento (%)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 8" value={form["ad_productivityGainPct"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_productivityGainPct: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Motor de Riscos */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Riscos — Matriz Probabilidade × Impacto</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Dados para calcular o valor esperado de perda e classificar riscos pela matriz probabilidade × impacto.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Concentração no maior cliente (%)</Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 35" value={form["ad_topClientConcentration"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_topClientConcentration: e.target.value }))} />
                </div>
              </div>
              {([1, 2, 3] as const).map((i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Risco {i}</p>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Nome do risco
                        <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                      </Label>
                      <Input
                        type="text"
                        placeholder={`Ex: Inadimplência de clientes`}
                        value={form[`ad_risk${i}Name`] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [`ad_risk${i}Name`]: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Probabilidade (%)</Label>
                        <Input type="number" min="0" max="100" placeholder="Ex: 40" value={form[`ad_risk${i}Probability`] ?? ""}
                          onChange={(e) => setForm((f) => ({ ...f, [`ad_risk${i}Probability`]: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Impacto financeiro (R$)</Label>
                        <Input type="number" placeholder="Ex: 50000" value={form[`ad_risk${i}Impact`] ?? ""}
                          onChange={(e) => setForm((f) => ({ ...f, [`ad_risk${i}Impact`]: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Inovação */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inovação — Motor de Automação</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Dados usados para calcular o ROI de automação e o score do motor de Inovação.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Horas/mês em processos manuais</Label>
                  <Input type="number" placeholder="Ex: 40" value={form["ad_manualProcessHours"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_manualProcessHours: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Custo do operador (R$/h)</Label>
                  <Input type="number" placeholder="Ex: 25" value={form["ad_operatorHourlyCost"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_operatorHourlyCost: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Investimento em automação (R$)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" placeholder="Ex: 15000" value={form["ad_automationInvestment"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_automationInvestment: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Taxa de erro no processo manual (%)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" placeholder="Ex: 5" value={form["ad_errorRatePct"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_errorRatePct: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Inteligência de Mercado */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inteligência de Mercado</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Dados de mercado para calcular participação, crescimento relativo e benchmarks setoriais.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tamanho do mercado total (R$)</Label>
                  <Input type="number" placeholder="Ex: 50000000" value={form["ad_marketSize"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_marketSize: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Crescimento do mercado ao ano (%)</Label>
                  <Input type="number" placeholder="Ex: 8" value={form["ad_marketGrowthPct"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_marketGrowthPct: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Crescimento da empresa ao ano (%)</Label>
                  <Input type="number" placeholder="Ex: 12" value={form["ad_companyGrowthPct"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_companyGrowthPct: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Margem bruta do setor — benchmark (%)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" placeholder="Ex: 45" value={form["ad_benchmarkGrossMargin"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_benchmarkGrossMargin: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Conversão do setor — benchmark (%)
                    <span className="ml-1 text-muted-foreground font-normal">— opcional</span>
                  </Label>
                  <Input type="number" placeholder="Ex: 15" value={form["ad_benchmarkConversion"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_benchmarkConversion: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Rede */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rede — Indicadores de Franquia / Associativismo</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Preencha quando a empresa faz parte de uma rede (franquia, associação, grupo de compras).
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Índice de eficiência na rede (0–100)</Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 72" value={form["ad_networkEfficiencyIndex"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_networkEfficiencyIndex: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Gap para o modelo ideal (%)</Label>
                  <Input type="number" min="0" max="100" placeholder="Ex: 18" value={form["ad_gapToIdealModel"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_gapToIdealModel: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Posição no ranking da rede</Label>
                  <Input type="number" min="1" placeholder="Ex: 12" value={form["ad_networkRank"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_networkRank: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Total de unidades na rede</Label>
                  <Input type="number" min="1" placeholder="Ex: 85" value={form["ad_totalNetworkUnits"] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_totalNetworkUnits: e.target.value }))} />
                </div>
              </div>
            </div>

          </div>
          )} {/* end 3-way conditional: loading / loadError / form */}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!form.period.trim() || upsertMut.isPending || loadingPeriod || (loadError && isExistingPeriod)}>
              {upsertMut.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <ImportDialog
        companyId={companyId}
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
