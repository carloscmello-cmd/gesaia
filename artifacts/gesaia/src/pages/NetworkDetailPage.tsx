import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  listNetworks, getListNetworksQueryKey,
  listCompanies, getListCompaniesQueryKey,
  useUpdateNetwork, useUpdateCompany,
} from "@workspace/api-client-react";
import {
  Network, Building2, ArrowLeft, Pencil, Users, Trophy,
  ExternalLink, Loader2, Trash2, AlertTriangle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import NetworkDiagnosisPanel from "@/components/company/NetworkDiagnosisPanel";

/* ── Units manager dialog (identical to NetworksPage) ───────────────────── */
function UnitsDialog({
  open, onOpenChange, network, allCompanies,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  network: { id: number; name: string } | null;
  allCompanies: any[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const linkMut   = useUpdateCompany({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() }) } });
  const unlinkMut = useUpdateCompany({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() }) } });

  if (!network) return null;
  const linked   = allCompanies.filter(c => c.networkId === network.id);
  const unlinked = allCompanies.filter(c => !c.networkId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("networks.units.manageTitle", { name: network.name })}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {linked.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("networks.units.linked")}</p>
              <div className="space-y-2">
                {linked.map(c => (
                  <div key={c.id} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                    <span className="text-sm text-foreground">{c.name}</span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                      disabled={unlinkMut.isPending}
                      onClick={() => unlinkMut.mutate({ id: c.id, data: { networkId: null } as any })}>
                      {t("networks.units.unlink")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {unlinked.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("networks.units.available")}</p>
              <div className="space-y-2">
                {unlinked.map(c => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <span className="text-sm text-foreground">{c.name}</span>
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={linkMut.isPending}
                      onClick={() => linkMut.mutate({ id: c.id, data: { networkId: network.id } as any })}>
                      {t("networks.units.link")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {linked.length === 0 && unlinked.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{t("networks.units.noCompanies")}</p>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Edit network dialog ────────────────────────────────────────────────── */
function EditDialog({ open, onOpenChange, network, onSubmit, loading }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  network: { name: string; description: string } | null;
  onSubmit: (d: { name: string; description: string }) => void;
  loading?: boolean;
}) {
  const [name, setName] = useState(network?.name ?? "");
  const [desc, setDesc] = useState(network?.description ?? "");
  if (!network) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Editar rede</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-1" /></div>
          <div><Label>Descrição</Label><Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className="mt-1" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSubmit({ name, description: desc })} disabled={!name.trim() || loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function NetworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const networkId = Number(id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [editOpen, setEditOpen]       = useState(false);
  const [unitsOpen, setUnitsOpen]     = useState(false);
  const [deleteOpen, setDeleteOpen]   = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: networks = [], isLoading: loadingNetworks } = useQuery({
    queryKey: getListNetworksQueryKey(),
    queryFn: listNetworks,
  });
  const { data: allCompanies = [] } = useQuery({
    queryKey: getListCompaniesQueryKey(),
    queryFn: listCompanies,
  });

  const network = networks.find(n => n.id === networkId) ?? null;
  const units   = allCompanies.filter(c => c.networkId === networkId);

  const handleDelete = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const r = await fetch(`/api/networks/${networkId}`, { method: "DELETE", credentials: "include" });
      if (r.status === 409) { const e = await r.json(); setDeleteError(e.error); return; }
      if (!r.ok) throw new Error(`Erro ${r.status}`);
      qc.invalidateQueries({ queryKey: getListNetworksQueryKey() });
      setLocation("/networks");
    } catch (e: any) { setDeleteError(e.message ?? "Erro ao excluir rede"); }
    finally { setDeleteLoading(false); }
  };

  const updateMut = useUpdateNetwork({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListNetworksQueryKey() });
        setEditOpen(false);
        toast({ title: "Rede atualizada" });
      },
      onError: () => toast({ title: "Erro ao atualizar rede", variant: "destructive" }),
    },
  });

  if (loadingNetworks) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  if (!network) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Card><CardContent className="py-16 text-center text-muted-foreground">Rede não encontrada.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back + header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/networks")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Network className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{network.name}</h1>
            {network.description && <p className="text-sm text-muted-foreground">{network.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 no-print">
          <Badge variant="secondary" className="gap-1.5">
            <Building2 className="w-3 h-3" />
            {units.length} unidade{units.length !== 1 ? "s" : ""}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setUnitsOpen(true)}>
            <Users className="w-4 h-4 mr-2" />Gerenciar unidades
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => { setDeleteError(null); setDeleteOpen(true); }}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="units">
        <TabsList className="no-print">
          <TabsTrigger value="units"><Building2 className="w-4 h-4 mr-1.5" />Unidades</TabsTrigger>
          <TabsTrigger value="diagnosis"><Trophy className="w-4 h-4 mr-1.5" />Diagnóstico de Rede</TabsTrigger>
        </TabsList>

        {/* Units tab */}
        <TabsContent value="units" className="mt-4">
          {units.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center gap-3">
                <Building2 className="w-10 h-10 text-muted-foreground/30" />
                <p className="font-medium text-foreground">Nenhuma unidade vinculada</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Vincule empresas à esta rede para começar a comparar os resultados.
                </p>
                <Button size="sm" onClick={() => setUnitsOpen(true)}>
                  <Users className="w-4 h-4 mr-2" />Gerenciar unidades
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {units.map(c => (
                <Card key={c.id} className="hover:border-primary/40 hover:shadow-md transition-all group">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100"
                        onClick={() => setLocation(`/companies/${c.id}`)}>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                    <p className="font-semibold text-foreground text-sm">{c.name}</p>
                    {c.segment && <p className="text-xs text-muted-foreground mt-0.5">{c.segment}</p>}
                    {c.activity && <p className="text-xs text-muted-foreground/70">{c.activity}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Diagnosis tab */}
        <TabsContent value="diagnosis" className="mt-4">
          {units.length < 2 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center gap-3">
                <Trophy className="w-10 h-10 text-muted-foreground/30" />
                <p className="font-medium text-foreground">Vincule pelo menos 2 unidades</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  O Diagnóstico de Rede compara unidades entre si. Adicione mais unidades para começar.
                </p>
              </CardContent>
            </Card>
          ) : (
            <NetworkDiagnosisPanel networkId={networkId} networkName={network.name} />
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <EditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        network={network ? { name: network.name, description: network.description ?? "" } : null}
        loading={updateMut.isPending}
        onSubmit={({ name, description }) => updateMut.mutate({ id: networkId, data: { name, description: description || undefined } })}
      />
      <UnitsDialog open={unitsOpen} onOpenChange={setUnitsOpen} network={network} allCompanies={allCompanies} />

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={(v) => { if (!deleteLoading) { setDeleteOpen(v); setDeleteError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Excluir rede
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-foreground">
              Tem certeza que deseja excluir <strong>{network?.name}</strong>? Esta ação não pode ser desfeita.
            </p>
            {deleteError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {deleteError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteError(null); }} disabled={deleteLoading}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Excluir rede
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
