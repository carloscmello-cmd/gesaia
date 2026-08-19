import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  listNetworks,
  getListNetworksQueryKey,
  listCompanies,
  getListCompaniesQueryKey,
  useCreateNetwork,
  useUpdateNetwork,
  useUpdateCompany,
} from "@workspace/api-client-react";
import {
  Network,
  Plus,
  Building2,
  Loader2,
  Pencil,
  Users,
  Link2,
  Link2Off,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

/* ── Network form dialog ─────────────────────────────────────────────── */
function NetworkFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  loading,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: { name: string; description: string };
  onSubmit: (data: { name: string; description: string }) => void;
  loading?: boolean;
  title?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");

  // Sync form fields whenever the dialog opens or initial data changes
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDesc(initial?.description ?? "");
    }
  }, [open, initial?.name, initial?.description]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? t("networks.newNetwork")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("networks.form.nameLabel")}</Label>
            <Input
              placeholder={t("networks.form.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("networks.form.descLabel")}</Label>
            <Textarea
              placeholder={t("networks.form.descPlaceholder")}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSubmit({ name, description: desc })} disabled={!name || loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {t("networks.saveNetwork")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Unit manager dialog ─────────────────────────────────────────────── */
function UnitsDialog({
  open,
  onOpenChange,
  network,
  allCompanies,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  network: { id: number; name: string } | null;
  allCompanies: Array<{ id: number; name: string; segment: string; networkId?: number | null }>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const linked = allCompanies.filter((c) => c.networkId === network?.id);
  const unlinked = allCompanies.filter(
    (c) =>
      !c.networkId &&
      (!search || c.name.toLowerCase().includes(search.toLowerCase())),
  );

  const updateCompanyMut = useUpdateCompany({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        qc.invalidateQueries({ queryKey: getListNetworksQueryKey() });
      },
      onError: () => toast({ title: t("networks.units.companyUpdateError"), variant: "destructive" }),
    },
  });

  if (!network) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            {t("networks.units.dialogTitle", { name: network.name })}
          </DialogTitle>
        </DialogHeader>

        {/* Current units */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("networks.units.linked", { count: linked.length })}
          </p>
          {linked.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">{t("networks.units.noneLinked")}</p>
          ) : (
            <div className="space-y-1.5">
              {linked.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-muted/20"
                >
                  <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground line-clamp-1">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.segment}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0 gap-1.5"
                    disabled={updateCompanyMut.isPending}
                    onClick={() => updateCompanyMut.mutate({ id: c.id, data: { networkId: null } })}
                  >
                    <Link2Off className="w-3.5 h-3.5" />
                    {t("networks.units.unlink")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("networks.units.addCompany")}
          </p>
          <Input
            placeholder={t("networks.units.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
          {unlinked.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {search ? t("networks.units.notFound") : t("networks.units.allLinked")}
            </p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {unlinked.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-primary/40 transition-colors"
                >
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground line-clamp-1">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.segment}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary hover:bg-primary/10 flex-shrink-0 gap-1.5"
                    disabled={updateCompanyMut.isPending}
                    onClick={() =>
                      updateCompanyMut.mutate({ id: c.id, data: { networkId: network.id } })
                    }
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    {t("networks.units.link")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("networks.units.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main page ───────────────────────────────────────────────────────── */
export default function NetworksPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: number;
    name: string;
    description: string;
  } | null>(null);
  const [unitsTarget, setUnitsTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
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

  const handleDelete = async (id: number) => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const r = await fetch(`/api/networks/${id}`, { method: "DELETE", credentials: "include" });
      if (r.status === 409) { const e = await r.json(); setDeleteError(e.error); return; }
      if (!r.ok) throw new Error(`Erro ${r.status}`);
      qc.invalidateQueries({ queryKey: getListNetworksQueryKey() });
      setDeleteTarget(null);
    } catch (e: any) { setDeleteError(e.message ?? "Erro ao excluir rede"); }
    finally { setDeleteLoading(false); }
  };

  const createMut = useCreateNetwork({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListNetworksQueryKey() });
        setCreateOpen(false);
        toast({ title: t("networks.toasts.created") });
      },
      onError: () => toast({ title: t("networks.toasts.createError"), variant: "destructive" }),
    },
  });

  const updateMut = useUpdateNetwork({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListNetworksQueryKey() });
        setEditTarget(null);
        toast({ title: t("networks.toasts.updated") });
      },
      onError: () => toast({ title: t("networks.toasts.updateError"), variant: "destructive" }),
    },
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            {t("networks.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("networks.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t("networks.newNetwork")}
        </Button>
      </div>

      {loadingNetworks ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : networks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Network className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-lg font-medium text-foreground">{t("networks.noNetworks")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("networks.noNetworksHint")}
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t("networks.createNetwork")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {networks.map((network) => {
            const unitCount = allCompanies.filter((c) => c.networkId === network.id).length;
            return (
              <Card
                key={network.id}
                className="hover:border-primary/40 hover:shadow-md transition-all group"
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Network className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setEditTarget({
                            id: network.id,
                            name: network.name,
                            description: network.description ?? "",
                          })
                        }
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => { setDeleteError(null); setDeleteTarget({ id: network.id, name: network.name }); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <p className="font-semibold text-foreground">{network.name}</p>
                  {network.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {network.description}
                    </p>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Building2 className="w-3 h-3" />
                      <span>
                        {unitCount === 0
                          ? t("networks.units.noUnits")
                          : t(
                              unitCount === 1 ? "networks.unit_one" : "networks.unit_other",
                              { count: unitCount },
                            )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={() => setUnitsTarget({ id: network.id, name: network.name })}
                      >
                        <Users className="w-3 h-3" />
                        {t("networks.units.manage")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={() => setLocation(`/networks/${network.id}`)}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Abrir
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create */}
      <NetworkFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("networks.newNetwork")}
        loading={createMut.isPending}
        onSubmit={({ name, description }) =>
          createMut.mutate({ data: { name, description: description || undefined } })
        }
      />

      {/* Edit */}
      <NetworkFormDialog
        open={!!editTarget}
        onOpenChange={(v) => !v && setEditTarget(null)}
        title={t("networks.editNetwork")}
        initial={editTarget ?? undefined}
        loading={updateMut.isPending}
        onSubmit={({ name, description }) => {
          if (!editTarget) return;
          updateMut.mutate({ id: editTarget.id, data: { name, description: description || undefined } });
        }}
      />

      {/* Units manager */}
      <UnitsDialog
        open={!!unitsTarget}
        onOpenChange={(v) => !v && setUnitsTarget(null)}
        network={unitsTarget}
        allCompanies={allCompanies}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!deleteLoading) { if (!v) { setDeleteTarget(null); setDeleteError(null); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Excluir rede
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-foreground">
              Tem certeza que deseja excluir <strong>{deleteTarget?.name}</strong>? Esta ação não pode ser desfeita.
            </p>
            {deleteError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2 text-sm text-amber-800 dark:text-amber-300">
                <Building2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {deleteError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteError(null); }} disabled={deleteLoading}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => deleteTarget && handleDelete(deleteTarget.id)} disabled={deleteLoading}>
              {deleteLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Excluir rede
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
