import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileText, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import React, { useState } from "react";
import { getReportSummary } from "./reportSummary";

export interface Report {
  id: number;
  companyId: number;
  title: string;
  type: string;
  content: Record<string, unknown>;
  createdAt: string;
}

export const getCompanyReportsQueryKey = (companyId: number) =>
  ["company-reports", companyId] as const;

export async function fetchCompanyReports(companyId: number): Promise<Report[]> {
  const res = await fetch(`/api/reports/${companyId}/reports`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Erro ao carregar relatórios");
  const all: Report[] = await res.json();
  return all.filter((r) => r.type === "full_analysis");
}


interface ReportsPanelProps {
  companyId: number;
}

const TYPE_LABELS: Record<string, string> = {
  full_analysis: "Relatório Completo",
  quick_diagnosis: "Diagnóstico Rápido",
};

export default function ReportsPanel({ companyId }: ReportsPanelProps) {
  const qc = useQueryClient();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const { data: reports, isLoading } = useQuery<Report[]>({
    queryKey: getCompanyReportsQueryKey(companyId),
    queryFn: () => fetchCompanyReports(companyId),
    enabled: !!companyId,
  });

  const deleteMut = useMutation({
    mutationFn: async (reportId: number) => {
      const res = await fetch(`/api/reports/${companyId}/reports/${reportId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao excluir relatório");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getCompanyReportsQueryKey(companyId) });
      toast({ title: "Relatório excluído" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir relatório", variant: "destructive" });
    },
  });

  const handleDownload = async (report: Report) => {
    setDownloadingId(report.id);
    try {
      const res = await fetch(`/api/reports/${report.id}/download`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Falha ao gerar PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.title.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF baixado com sucesso" });
    } catch {
      toast({ title: "Erro ao baixar PDF", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="font-medium text-foreground">Nenhum relatório gerado ainda</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Exporte o primeiro relatório usando o botão{" "}
            <span className="font-medium">Exportar PDF</span> no topo da página.
            Todos os relatórios gerados ficarão disponíveis aqui para re-download.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        {reports.length} {reports.length === 1 ? "relatório gerado" : "relatórios gerados"}
      </p>
      {reports.map((report) => {
        const date = new Date(report.createdAt).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const isDownloading = downloadingId === report.id;
        const isDeleting = deleteMut.isPending && deleteMut.variables === report.id;

        return (
          <Card key={report.id}>
            <CardContent className="flex items-center justify-between p-4 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4.5 h-4.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{report.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABELS[report.type] ?? report.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{date}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {getReportSummary(report.content)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isDownloading || isDeleting}
                  onClick={() => handleDownload(report)}
                >
                  {isDownloading ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Baixar PDF
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={isDownloading || isDeleting}
                  onClick={() => deleteMut.mutate(report.id)}
                >
                  {isDeleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
