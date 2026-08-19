import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  listCompanies,
  getListCompaniesQueryKey,
  getMe,
  getGetMeQueryKey,
  useCreateCompany,
  useUpdateCompany,
} from "@workspace/api-client-react";
import { Building2, Plus, Search, Pencil, Trash2, Network, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";

interface CompanyFormData {
  name: string;
  segment: string;
  activity: string;
  businessModel: string;
  greenMin: string;
  yellowMin: string;
}

function CompanyFormDialog({
  open,
  onOpenChange,
  onSubmit,
  loading,
  initial,
  title,
  showScoreThresholds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: CompanyFormData) => void;
  loading?: boolean;
  initial?: CompanyFormData;
  title?: string;
  showScoreThresholds?: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CompanyFormData>(
    initial ?? { name: "", segment: "", activity: "", businessModel: "", greenMin: "", yellowMin: "" },
  );
  const [thresholdError, setThresholdError] = useState("");

  const resetToInitial = () => {
    setForm(initial ?? { name: "", segment: "", activity: "", businessModel: "", greenMin: "", yellowMin: "" });
    setThresholdError("");
  };

  const update = (field: keyof CompanyFormData, val: string) =>
    setForm((f) => ({ ...f, [field]: val }));

  const submit = () => {
    const hasGreen = form.greenMin.trim() !== "";
    const hasYellow = form.yellowMin.trim() !== "";
    if (hasGreen || hasYellow) {
      const greenMin = Number(form.greenMin);
      const yellowMin = Number(form.yellowMin);
      if (
        !hasGreen ||
        !hasYellow ||
        !Number.isFinite(greenMin) ||
        !Number.isFinite(yellowMin) ||
        yellowMin < 0 ||
        greenMin > 100 ||
        yellowMin >= greenMin
      ) {
        setThresholdError(t("companies.form.thresholdsError"));
        return;
      }
    }
    setThresholdError("");
    onSubmit(form);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) resetToInitial();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {title ?? (initial ? t("companies.editCompany") : t("companies.newCompany"))}
          </DialogTitle>
        </DialogHeader>
          <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="co-name">{t("companies.form.nameLabel")}</Label>
            <Input
              id="co-name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder={t("companies.form.namePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-seg">{t("companies.form.segmentLabel")}</Label>
            <Input
              id="co-seg"
              value={form.segment}
              onChange={(e) => update("segment", e.target.value)}
              placeholder={t("companies.form.segmentPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-act">{t("companies.form.activityLabel")}</Label>
            <Input
              id="co-act"
              value={form.activity}
              onChange={(e) => update("activity", e.target.value)}
              placeholder={t("companies.form.activityPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-bm">{t("companies.form.businessModelLabel")}</Label>
            <Input
              id="co-bm"
              value={form.businessModel}
              onChange={(e) => update("businessModel", e.target.value)}
              placeholder={t("companies.form.businessModelPlaceholder")}
            />
          </div>
          {showScoreThresholds ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div>
                <p className="text-sm font-medium">{t("companies.form.thresholdsTitle")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("companies.form.thresholdsDescription")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="co-green-min">{t("companies.form.greenMinLabel")}</Label>
                  <Input
                    id="co-green-min"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={form.greenMin}
                    onChange={(e) => update("greenMin", e.target.value)}
                    placeholder="70"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="co-yellow-min">{t("companies.form.yellowMinLabel")}</Label>
                  <Input
                    id="co-yellow-min"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={form.yellowMin}
                    onChange={(e) => update("yellowMin", e.target.value)}
                    placeholder="40"
                  />
                </div>
              </div>
              {thresholdError ? <p className="text-xs text-destructive">{thresholdError}</p> : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={
              loading ||
              !form.name ||
              !form.segment ||
              !form.activity ||
              !form.businessModel
            }
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CompaniesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: number; data: CompanyFormData } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const { data: me } = useQuery({
    queryKey: getGetMeQueryKey(),
    queryFn: getMe,
    staleTime: 60_000,
  });
  const canConfigureScoreThresholds = me?.role === "admin";

  const { data: companies = [], isLoading } = useQuery({
    queryKey: getListCompaniesQueryKey(),
    queryFn: listCompanies,
  });

  const createMut = useCreateCompany({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        setCreateOpen(false);
        toast({ title: t("companies.toasts.created") });
      },
      onError: () => toast({ title: t("companies.toasts.createError"), variant: "destructive" }),
    },
  });

  const updateMut = useUpdateCompany({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        setEditTarget(null);
        toast({ title: t("companies.toasts.updated") });
      },
      onError: () => toast({ title: t("companies.toasts.updateError"), variant: "destructive" }),
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/companies/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      setDeleteTarget(null);
      toast({ title: t("companies.toasts.removed") });
    },
    onError: () => toast({ title: t("companies.toasts.removeError"), variant: "destructive" }),
  });

  const filtered = companies.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.segment.toLowerCase().includes(search.toLowerCase()),
  );

  const toCompanyPayload = (data: CompanyFormData) => {
    const { greenMin, yellowMin, ...companyData } = data;
    if (!canConfigureScoreThresholds) return companyData;

    const hasThresholds = greenMin.trim() !== "" || yellowMin.trim() !== "";
    return {
      ...companyData,
      scoreThresholds: hasThresholds
        ? { greenMin: Number(greenMin), yellowMin: Number(yellowMin) }
        : null,
    };
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            {t("companies.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("companies.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t("companies.newCompany")}
        </Button>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={t("companies.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Building2 className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-lg font-medium text-foreground">
              {search ? t("common.noResults") : t("companies.noCompany")}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? t("common.tryDifferentTerm") : t("companies.addFirstCompany")}
            </p>
            {!search && (
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t("companies.addCompany")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((company) => (
            <Card
              key={company.id}
              className="hover:border-primary/40 hover:shadow-md transition-all group"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditTarget({
                          id: company.id,
                          data: {
                            name: company.name,
                            segment: company.segment,
                            activity: company.activity,
                            businessModel: company.businessModel,
                             greenMin: company.scoreThresholds?.greenMin?.toString() ?? "",
                             yellowMin: company.scoreThresholds?.yellowMin?.toString() ?? "",
                          },
                        });
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleteTarget({ id: company.id, name: company.name });
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>

                <Link href={`/companies/${company.id}`}>
                  <a className="block">
                    <p className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1 cursor-pointer">
                      {company.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {company.segment}
                      </Badge>
                      {company.networkId && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Network className="w-2.5 h-2.5" />
                          {t("companies.networkBadge")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-1">
                      {company.activity}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {company.businessModel}
                    </p>
                  </a>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CompanyFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        loading={createMut.isPending}
        showScoreThresholds={canConfigureScoreThresholds}
        onSubmit={(data) => createMut.mutate({ data: toCompanyPayload(data) })}
        title={t("companies.newCompany")}
      />

      {/* Edit dialog — key forces remount when target changes, so useState re-initialises with the correct data */}
      <CompanyFormDialog
        key={editTarget?.id ?? "edit-closed"}
        open={!!editTarget}
        onOpenChange={(v) => !v && setEditTarget(null)}
        loading={updateMut.isPending}
        initial={editTarget?.data}
        title={t("companies.editCompany")}
        showScoreThresholds={canConfigureScoreThresholds}
        onSubmit={(data) => {
          if (!editTarget) return;
          updateMut.mutate({ id: editTarget.id, data: toCompanyPayload(data) });
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("companies.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("companies.delete.description", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {t("companies.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
