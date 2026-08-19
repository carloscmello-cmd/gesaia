import React, { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShieldOff, ShieldCheck, Loader2, AlertTriangle, Pencil, MailPlus, ChevronDown, Building2,
  MailX, RefreshCw,
} from "lucide-react";
import {
  getMe, getGetMeQueryKey,
  listUsers, getListUsersQueryKey,
  listPendingInvitations, getListPendingInvitationsQueryKey,
  listUserCompanies, getListUserCompaniesQueryKey,
  useUpdateUser, useDeleteUser, useInviteUser,
  useRevokeInvitation, useResendInvitation,
} from "@workspace/api-client-react";
import type { PendingInvitation } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type Role = "admin" | "consultant" | "manager" | "viewer";
const ROLES: Role[] = ["admin", "consultant", "manager", "viewer"];
const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gerente",
  consultant: "Consultor",
  viewer: "Visualizador",
};

function roleBadgeVariant(role: Role): "default" | "secondary" | "outline" | "destructive" {
  switch (role) {
    case "admin":      return "default";
    case "manager":    return "secondary";
    case "consultant": return "outline";
    case "viewer":     return "outline";
  }
}

/** Return a clean email — hide Clerk placeholder values. */
function displayEmail(email: string): string {
  if (!email || email.endsWith("@unknown.clerk")) return "—";
  return email;
}

function LinkedCompaniesRow({ userId }: { userId: number }) {
  const { data: linkedCompanies = [], isLoading, isError } = useQuery({
    queryKey: getListUserCompaniesQueryKey(userId),
    queryFn: () => listUserCompanies(userId),
  });

  return (
    <tr className="bg-muted/30">
      <td colSpan={6} className="px-4 py-3">
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Empresas vinculadas</p>
            {isLoading ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando empresas...
              </div>
            ) : isError ? (
              <p className="mt-1 text-xs text-destructive">Não foi possível carregar as empresas vinculadas.</p>
            ) : linkedCompanies.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nenhuma empresa vinculada a este usuário.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {linkedCompanies.map((company) => (
                  <Link key={company.id} href={`/companies/${company.id}`}>
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-muted hover:text-foreground"
                    >
                      {company.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: getGetMeQueryKey(), queryFn: getMe });

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: getListUsersQueryKey(),
    queryFn: listUsers,
    enabled: me?.role === "admin",
  });
  const {
    data: pendingInvitations = [],
    isLoading: isLoadingInvitations,
    isError: isInvitationsError,
  } = useQuery({
    queryKey: getListPendingInvitationsQueryKey(),
    queryFn: listPendingInvitations,
    enabled: me?.role === "admin",
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const updateUser = useUpdateUser({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "Usuário atualizado" });
      },
      onError: () => toast({ title: "Erro ao atualizar usuário", variant: "destructive" }),
    },
  });

  const deleteUser = useDeleteUser({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "Acesso desativado" });
      },
      onError: (err: unknown) => {
        const status = (err as { status?: number })?.status;
        if (status === 409) {
          toast({
            title: "Usuário possui empresas vinculadas",
            description: "Reatribua ou exclua as empresas deste usuário antes de desativá-lo.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Erro ao desativar usuário", variant: "destructive" });
        }
      },
    },
  });

  const inviteUser = useInviteUser({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPendingInvitationsQueryKey() });
        setInviteEmail("");
        setInviteOpen(false);
        toast({ title: "Convite enviado", description: "A pessoa receberá um e-mail com o link de cadastro." });
      },
      onError: (err: unknown) => {
        const status = (err as { status?: number })?.status;
        const message = (err as { data?: { message?: string } })?.data?.message;
        toast({
          title: status === 409 ? "Convite já existente" : "Não foi possível enviar o convite",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  const revokeInvitation = useRevokeInvitation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPendingInvitationsQueryKey() });
        setPendingCancelInvitationId(null);
        toast({ title: "Convite cancelado", description: "O link de cadastro foi revogado." });
      },
      onError: () => {
        setPendingCancelInvitationId(null);
        toast({ title: "Erro ao cancelar convite", variant: "destructive" });
      },
    },
  });

  const resendInvitation = useResendInvitation({
    mutation: {
      onSuccess: (newInvitation, variables) => {
        qc.setQueryData<PendingInvitation[]>(
          getListPendingInvitationsQueryKey(),
          (invitations) => invitations?.map((invitation) => (
            invitation.id === variables.id ? newInvitation : invitation
          )),
        );
        qc.invalidateQueries({ queryKey: getListPendingInvitationsQueryKey() });
        toast({ title: "Convite reenviado", description: "Um novo e-mail de cadastro foi enviado." });
      },
      onError: (err: unknown) => {
        const status = (err as { status?: number })?.status;
        const message = (err as { data?: { message?: string } })?.data?.message;
        toast({
          title: status === 409 ? "Já existe um cadastro para este e-mail" : "Erro ao reenviar convite",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  // Dialogs state
  const [pendingDisableId,          setPendingDisableId]          = useState<number | null>(null);
  const [pendingReenableId,         setPendingReenableId]         = useState<number | null>(null);
  const [actionUserId,              setActionUserId]              = useState<number | null>(null);
  const [editUser,                  setEditUser]                  = useState<{ id: number; name: string } | null>(null);
  const [editName,                  setEditName]                  = useState("");
  const [inviteOpen,                setInviteOpen]                = useState(false);
  const [inviteEmail,               setInviteEmail]               = useState("");
  const [expandedUserId,            setExpandedUserId]            = useState<number | null>(null);
  const [pendingCancelInvitationId, setPendingCancelInvitationId] = useState<string | null>(null);

  const pendingUser = users.find(
    (u) => u.id === pendingDisableId || u.id === pendingReenableId,
  );

  function handleRoleChange(userId: number, role: Role) {
    updateUser.mutate({ id: userId, data: { role } });
  }

  function openEdit(user: { id: number; name: string }) {
    setEditUser(user);
    setEditName(user.name);
  }

  function handleEditSave() {
    if (!editUser || !editName.trim()) return;
    updateUser.mutate(
      { id: editUser.id, data: { name: editName.trim() } as any },
      { onSettled: () => setEditUser(null) },
    );
  }

  function handleDisableConfirm() {
    if (pendingDisableId == null) return;
    setActionUserId(pendingDisableId);
    setPendingDisableId(null);
    deleteUser.mutate({ id: pendingDisableId }, { onSettled: () => setActionUserId(null) });
  }

  function handleReenableConfirm() {
    if (pendingReenableId == null) return;
    setActionUserId(pendingReenableId);
    setPendingReenableId(null);
    updateUser.mutate(
      { id: pendingReenableId, data: { disabled: false } },
      { onSettled: () => setActionUserId(null) },
    );
  }

  function handleInviteSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteUser.mutate({ data: { email: inviteEmail.trim() } });
  }

  if (me?.role !== "admin") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertTriangle className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Acesso restrito a administradores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Usuários
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie papéis e acesso dos consultores cadastrados no sistema.
          </p>
        </div>

        {/* Invite */}
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5">
          <div className="text-sm">
            <p className="font-medium text-foreground">Convidar novo usuário</p>
            <p className="text-xs text-muted-foreground">
              Envie um e-mail para que um novo consultor conclua o cadastro.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setInviteOpen(true)}>
            <MailPlus className="w-4 h-4" />
            Convidar por e-mail
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Todos os usuários
          </CardTitle>
          <CardDescription>
            Altere papéis, confira as empresas vinculadas e desative acessos diretamente na tabela.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || isLoadingInvitations ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError || isInvitationsError ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-muted-foreground text-sm">Erro ao carregar usuários.</p>
            </div>
          ) : users.length === 0 && pendingInvitations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-muted-foreground text-sm">Nenhum usuário cadastrado ainda.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-medium text-muted-foreground pb-3 pr-4">Nome</th>
                    <th className="text-left font-medium text-muted-foreground pb-3 pr-4">E-mail</th>
                    <th className="text-left font-medium text-muted-foreground pb-3 pr-4">Papel</th>
                     <th className="text-left font-medium text-muted-foreground pb-3 pr-4">Empresas</th>
                    <th className="text-left font-medium text-muted-foreground pb-3 pr-4">Cadastro / último envio</th>
                    <th className="text-right font-medium text-muted-foreground pb-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((user) => {
                    const isMe      = user.id === me?.id;
                    const isUpdating = (updateUser.isPending && updateUser.variables?.id === user.id)
                                    || actionUserId === user.id;
                    const isDisabled = (user as any).disabled;

                    const isExpanded = expandedUserId === user.id;

                    return (
                      <Fragment key={user.id}>
                        <tr className={cn(isDisabled && "opacity-50")}>
                          {/* Name */}
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "font-medium",
                                isDisabled ? "text-muted-foreground line-through" : "text-foreground",
                              )}>
                                {user.name}
                              </span>
                              {isMe && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Você</Badge>
                              )}
                              {isDisabled && (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Desativado</Badge>
                              )}
                            </div>
                          </td>

                          {/* Email */}
                          <td className="py-3 pr-4 text-muted-foreground">
                            {displayEmail((user as any).email ?? "")}
                          </td>

                          {/* Role */}
                          <td className="py-3 pr-4">
                            {isMe || isDisabled ? (
                              <Badge variant={roleBadgeVariant(user.role as Role)}>
                                {ROLE_LABELS[user.role as Role] ?? user.role}
                              </Badge>
                            ) : (
                              <Select
                                value={user.role}
                                onValueChange={(v) => handleRoleChange(user.id, v as Role)}
                                disabled={isUpdating}
                              >
                                <SelectTrigger className="h-7 w-36 text-xs">
                                  {isUpdating
                                    ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{ROLE_LABELS[user.role as Role]}</span>
                                    : <SelectValue />
                                  }
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLES.map((r) => (
                                    <SelectItem key={r} value={r} className="text-xs">
                                      {ROLE_LABELS[r]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>

                          {/* Linked companies */}
                          <td className="py-3 pr-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                              aria-expanded={isExpanded}
                            >
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")} />
                              {isExpanded ? "Ocultar" : "Ver empresas"}
                            </Button>
                          </td>

                          {/* Since */}
                          <td className="py-3 pr-4 text-muted-foreground text-xs">
                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString("pt-BR") : "—"}
                          </td>

                          {/* Actions */}
                          <td className="py-3 text-right">
                            {!isMe && (
                              <div className="flex items-center justify-end gap-1">
                                {/* Edit name */}
                                {!isDisabled && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => openEdit({ id: user.id, name: user.name })}
                                    disabled={isUpdating}
                                    title="Editar nome"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {/* Disable / Re-enable */}
                                {isDisabled ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    onClick={() => setPendingReenableId(user.id)}
                                    disabled={isUpdating}
                                    title="Reativar acesso"
                                  >
                                    {isUpdating
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                                    }
                                    Reativar
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => setPendingDisableId(user.id)}
                                    disabled={isUpdating}
                                    title="Desativar acesso"
                                  >
                                    {isUpdating
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <ShieldOff className="w-3.5 h-3.5" />
                                    }
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                        {isExpanded && <LinkedCompaniesRow userId={user.id} />}
                      </Fragment>
                    );
                  })}
                  {pendingInvitations.map((invitation) => {
                    const isActingOnThis =
                      (revokeInvitation.isPending && revokeInvitation.variables?.id === invitation.id) ||
                      (resendInvitation.isPending && resendInvitation.variables?.id === invitation.id);
                    return (
                      <tr key={`invitation-${invitation.id}`} className="bg-muted/20">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-muted-foreground">Convite pendente</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Aguardando cadastro</Badge>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{invitation.email}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="outline">{ROLE_LABELS.consultant}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground">—</td>
                        <td className="py-3 pr-4 text-muted-foreground text-xs">
                          <span title="Último envio">
                            Último envio:{" "}
                            {new Date(invitation.createdAt).toLocaleString("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Resend */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => resendInvitation.mutate({ id: invitation.id })}
                              disabled={isActingOnThis}
                              title="Reenviar convite"
                            >
                              {resendInvitation.isPending && resendInvitation.variables?.id === invitation.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <RefreshCw className="w-3.5 h-3.5" />
                              }
                            </Button>
                            {/* Cancel */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingCancelInvitationId(invitation.id)}
                              disabled={isActingOnThis}
                              title="Cancelar convite"
                            >
                              {revokeInvitation.isPending && revokeInvitation.variables?.id === invitation.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <MailX className="w-3.5 h-3.5" />
                              }
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite user dialog */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) setInviteEmail("");
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convidar consultor</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="consultor@empresa.com"
                autoComplete="email"
                autoFocus
                disabled={inviteUser.isPending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              O consultor receberá um e-mail do Clerk com um link seguro para concluir o cadastro.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={inviteUser.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!inviteEmail.trim() || inviteUser.isPending}>
                {inviteUser.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Enviar convite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit name dialog */}
      <Dialog open={!!editUser} onOpenChange={(v) => { if (!v) setEditUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar nome</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Nome</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleEditSave()}
                placeholder="Nome do usuário"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancelar</Button>
            <Button onClick={handleEditSave} disabled={!editName.trim() || updateUser.isPending}>
              {updateUser.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable confirm */}
      <AlertDialog open={pendingDisableId !== null} onOpenChange={(o) => { if (!o) setPendingDisableId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar acesso</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUser?.name
                ? `"${pendingUser.name}" não poderá mais acessar o sistema. Você pode reativar o acesso depois.`
                : "Este usuário não poderá mais acessar o sistema. Você pode reativar o acesso depois."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisableConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Re-enable confirm */}
      <AlertDialog open={pendingReenableId !== null} onOpenChange={(o) => { if (!o) setPendingReenableId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reativar acesso</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUser?.name
                ? `"${pendingUser.name}" voltará a ter acesso ao sistema.`
                : "Este usuário voltará a ter acesso ao sistema."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReenableConfirm}>Reativar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel invitation confirm */}
      <AlertDialog
        open={pendingCancelInvitationId !== null}
        onOpenChange={(o) => { if (!o) setPendingCancelInvitationId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar convite</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const inv = pendingInvitations.find((i) => i.id === pendingCancelInvitationId);
                return inv
                  ? `O link de cadastro enviado para "${inv.email}" será revogado. A pessoa não conseguirá mais se cadastrar com esse link.`
                  : "O link de cadastro será revogado e o convite removido da lista.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCancelInvitationId) {
                  revokeInvitation.mutate({ id: pendingCancelInvitationId });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
