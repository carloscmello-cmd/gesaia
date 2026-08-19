import { useState, useRef } from "react";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  Stethoscope,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  RefreshCw,
  Printer,
  Download,
} from "lucide-react";

interface QuickDiagnosisPanelProps {
  companyId: number;
  companyName?: string;
}

type DiagnosisStatus = "profit" | "loss" | "unknown" | null;

// Render markdown-like sections with bold headings
function DiagnosisText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed text-foreground">
      {lines.map((line, i) => {
        // Bold heading: **TITLE**
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          const title = line.trim().replace(/\*\*/g, "");
          return (
            <p key={i} className="font-semibold text-foreground mt-4 first:mt-0">
              {title}
            </p>
          );
        }
        // Inline bold **text**
        if (line.includes("**")) {
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={i} className={line.trim() === "" ? "mt-2" : ""}>
              {parts.map((part, j) =>
                /^\*\*[^*]+\*\*$/.test(part) ? (
                  <strong key={j}>{part.replace(/\*\*/g, "")}</strong>
                ) : (
                  part
                )
              )}
            </p>
          );
        }
        // Bullet
        if (line.trim().startsWith("- ")) {
          return (
            <p key={i} className="pl-4">
              <span className="text-muted-foreground mr-1">•</span>
              {line.trim().slice(2)}
            </p>
          );
        }
        // Numbered list
        if (/^\d+\.\s/.test(line.trim())) {
          return (
            <p key={i} className="pl-4">
              {line.trim()}
            </p>
          );
        }
        // Empty line → spacing
        if (line.trim() === "") {
          return <div key={i} className="h-1" />;
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export default function QuickDiagnosisPanel({ companyId, companyName }: QuickDiagnosisPanelProps) {
  const [status, setStatus] = useState<DiagnosisStatus>(null);
  const [result, setResult] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function runDiagnosis() {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setText("");
    setStatus(null);
    setResult(null);
    setHasRun(true);

    try {
      const res = await fetch(`/api/companies/${companyId}/quick-diagnosis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
            if (evt.type === "status") {
              setStatus(evt.status);
              setResult(evt.result);
            } else if (evt.type === "text") {
              setText((t) => t + evt.text);
            } else if (evt.type === "error") {
              setError(evt.error);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message ?? "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  const brl = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

  function handlePrint() {
    window.print();
  }

  function handleDownloadPdf() {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const marginL = 20;
    const marginR = 20;
    const pageW  = 210;
    const contentW = pageW - marginL - marginR;
    let y = 20;

    const nl = (extra = 0) => { y += extra; };
    const checkPage = (needed = 8) => {
      if (y + needed > 280) { doc.addPage(); y = 20; }
    };

    // ── Header ────────────────────────────────────────────────────────────
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(30, 30, 30);
    doc.text("Diagnóstico Rápido", marginL, y);
    y += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    if (companyName) { doc.text(companyName, marginL, y); y += 5; }
    doc.text(
      `Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`,
      marginL, y,
    );
    y += 4;

    // Separator line
    doc.setDrawColor(200, 200, 200);
    doc.line(marginL, y, pageW - marginR, y);
    y += 6;

    // ── Status banner ─────────────────────────────────────────────────────
    if (cfg) {
      const statusColors: Record<string, [number, number, number]> = {
        profit:  [22, 163, 74],
        loss:    [220, 38, 38],
        unknown: [217, 119, 6],
      };
      const [r, g, b] = status ? (statusColors[status] ?? [80, 80, 80]) : [80, 80, 80];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(r, g, b);
      doc.text(cfg.label, marginL, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(cfg.sub, marginL, y);
      y += 5;

      doc.setDrawColor(200, 200, 200);
      doc.line(marginL, y, pageW - marginR, y);
      y += 6;
    }

    // ── Body text ─────────────────────────────────────────────────────────
    doc.setTextColor(30, 30, 30);
    const lines = text.split("\n");

    for (const raw of lines) {
      checkPage(7);
      const line = raw.trimEnd();

      // Full-line bold heading: **TITLE**
      if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
        nl(3);
        checkPage(8);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        const title = line.trim().replace(/\*\*/g, "");
        doc.text(title, marginL, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        continue;
      }

      // Empty line
      if (line.trim() === "") { y += 3; continue; }

      // Strip remaining inline ** markers for PDF (jsPDF can't mix inline bold)
      const clean = line.replace(/\*\*/g, "");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);

      // Bullet
      const isBullet = clean.trim().startsWith("- ");
      const indentX  = isBullet ? marginL + 5 : marginL;
      const displayText = isBullet ? `• ${clean.trim().slice(2)}` : clean;
      const wrapped = doc.splitTextToSize(displayText, contentW - (isBullet ? 5 : 0));

      for (const wl of wrapped) {
        checkPage(5);
        doc.text(wl, indentX, y);
        y += 5;
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(160, 160, 160);
      doc.text("GESAIA — Plataforma de Inteligência Gerencial", marginL, 290);
      doc.text(`Página ${p} de ${pageCount}`, pageW - marginR, 290, { align: "right" });
    }

    const safeName = (companyName ?? "empresa").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    doc.save(`diagnostico_rapido_${safeName}.pdf`);
  }

  const statusConfig = {
    profit: {
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      border: "border-emerald-200 dark:border-emerald-800",
      text: "text-emerald-700 dark:text-emerald-400",
      icon: TrendingUp,
      label: "Empresa Lucrativa",
      sub: result != null ? `Resultado estimado: ${brl(result)}` : "Resultado positivo",
    },
    loss: {
      bg: "bg-red-50 dark:bg-red-950/40",
      border: "border-red-200 dark:border-red-800",
      text: "text-red-700 dark:text-red-400",
      icon: TrendingDown,
      label: "Empresa em Prejuízo",
      sub: result != null ? `Resultado estimado: ${brl(result)}` : "Resultado negativo",
    },
    unknown: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      border: "border-amber-200 dark:border-amber-800",
      text: "text-amber-700 dark:text-amber-400",
      icon: HelpCircle,
      label: "Dados Insuficientes",
      sub: "Cadastre receita, custos e despesas na aba Dados",
    },
  };

  const cfg = status ? statusConfig[status] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 no-print">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-primary" />
            Diagnóstico Rápido
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Analisa os dados cadastrados e responde: a empresa está dando lucro? Se não, como torná-la
            viável? Se sim, como melhorar?
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasRun && !loading && text && (
            <>
              <Button variant="outline" onClick={handleDownloadPdf} title="Baixar como PDF">
                <Download className="w-4 h-4 mr-2" />
                PDF
              </Button>
              <Button variant="outline" onClick={handlePrint} title="Imprimir diagnóstico">
                <Printer className="w-4 h-4 mr-2" />
                Imprimir
              </Button>
            </>
          )}
          <Button
            onClick={runDiagnosis}
            disabled={loading}
            variant={hasRun ? "outline" : "default"}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analisando…
              </>
            ) : hasRun ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refazer
              </>
            ) : (
              <>
                <Stethoscope className="w-4 h-4 mr-2" />
                Gerar Diagnóstico
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="print-only hidden">
        <h2 className="text-xl font-bold">Diagnóstico Rápido — GESAIA</h2>
        <p className="text-sm text-gray-500 mt-1">
          Gerado em {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
        </p>
        <hr className="mt-3 mb-4" />
      </div>

      {/* Status banner */}
      {cfg && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${cfg.bg} ${cfg.border}`}>
          <cfg.icon className={`w-5 h-5 shrink-0 ${cfg.text}`} />
          <div>
            <p className={`font-semibold ${cfg.text}`}>{cfg.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{cfg.sub}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Streaming output */}
      {(text || loading) && (
        <Card>
          <CardContent className="p-6">
            {text ? (
              <DiagnosisText text={text} />
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Gerando diagnóstico…
              </div>
            )}
            {loading && text && (
              <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 rounded-sm align-middle" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!hasRun && (
        <Card className="border-dashed">
          <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
            <Stethoscope className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground max-w-sm">
              Clique em <strong>Gerar Diagnóstico</strong> para receber uma análise automática da
              situação financeira da empresa com recomendações específicas e acionáveis.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
