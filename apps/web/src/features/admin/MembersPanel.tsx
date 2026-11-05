import * as React from "react";
import { Copy, Mail, Trash2, UserPlus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useMe } from "@/features/auth/hooks";
import { useMembers } from "@/features/settings/hooks";
import {
  useCreateInvitation,
  useInvitations,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateMemberRole,
} from "@/features/workspaces/hooks";
import { errorMessage } from "@/services/api";
import { formatDate, formatRelative, initials } from "@/lib/utils";
import { ROLE_LABELS, type Invitation, type Member, type Role } from "@/types/api";

const ROLES: Role[] = ["admin", "editor", "viewer"];
const ROLE_HELP: Record<Role, string> = {
  admin: "Gerencia membros, configurações, limites e auditoria.",
  editor: "Envia e organiza documentos, cria conversas e análises.",
  viewer: "Consulta documentos autorizados, pergunta e vê o próprio histórico.",
};

export function MembersPanel() {
  const { data: me } = useMe();
  const members = useMembers();
  const invitations = useInvitations();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const revokeInvitation = useRevokeInvitation();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<Member | null>(null);

  const adminCount = members.data?.filter((m) => m.role === "admin").length ?? 0;

  const onChangeRole = async (m: Member, role: Role) => {
    if (role === m.role) return;
    if (m.user_id === me?.id && role !== "admin") {
      toast({ kind: "error", title: "Ação bloqueada", description: "Você não pode rebaixar o próprio papel. Peça a outro administrador." });
      return;
    }
    if (m.role === "admin" && role !== "admin" && adminCount <= 1) {
      toast({ kind: "error", title: "Ação bloqueada", description: "O workspace precisa manter pelo menos um administrador." });
      return;
    }
    try {
      await updateRole.mutateAsync({ userId: m.user_id, role });
      toast({ kind: "success", title: "Papel atualizado", description: `${m.name} agora é ${ROLE_LABELS[role].toLowerCase()}.` });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível alterar o papel", description: errorMessage(e) });
    }
  };

  const onRemove = async () => {
    if (!removing) return;
    try {
      await removeMember.mutateAsync(removing.user_id);
      toast({ kind: "success", title: "Membro removido", description: `${removing.name} perdeu o acesso a este workspace.` });
      setRemoving(null);
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível remover", description: errorMessage(e) });
    }
  };

  const onRevokeInvitation = async (inv: Invitation) => {
    try {
      await revokeInvitation.mutateAsync(inv.id);
      toast({ kind: "success", title: "Convite revogado" });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível revogar", description: errorMessage(e) });
    }
  };

  const pending = (invitations.data ?? []).filter((i) => i.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Membros</h2>
          <p className="text-sm text-muted-foreground">Quem acessa este workspace e com qual papel.</p>
        </div>
        <Button variant="gradient" onClick={() => setInviteOpen(true)}>
          <UserPlus /> Convidar
        </Button>
      </div>

      {members.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : members.isError || !members.data ? (
        <p className="text-sm text-muted-foreground">Não foi possível listar os membros.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Membros do workspace</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">Nome</th>
                <th scope="col" className="px-3 py-2">E-mail</th>
                <th scope="col" className="px-3 py-2">Papel</th>
                <th scope="col" className="px-3 py-2">Desde</th>
                <th scope="col" className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.data.map((m) => {
                const isSelf = m.user_id === me?.id;
                return (
                  <tr key={m.user_id}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">{initials(m.name)}</span>
                        <span className="font-medium">{m.name}</span>
                        {isSelf ? <Badge variant="muted">você</Badge> : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{m.email}</td>
                    <td className="px-3 py-2">
                      <Select value={m.role} onValueChange={(v) => void onChangeRole(m, v as Role)} disabled={updateRole.isPending}>
                        <SelectTrigger className="h-8 w-40" aria-label={`Papel de ${m.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(m.joined_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(m)} disabled={isSelf} aria-label={`Remover ${m.name}`}>
                        <Trash2 /> Remover
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Mail className="size-4 text-primary" aria-hidden /> Convites pendentes
        </h3>
        {invitations.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Convites pendentes">
            {pending.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{inv.email}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ROLE_LABELS[inv.role]} · convidado por {inv.invited_by.name} {formatRelative(inv.created_at)} · expira em {formatDate(inv.expires_at)}
                  </span>
                </span>
                {inv.accept_url ? <CopyLinkButton url={inv.accept_url} /> : null}
                <Button variant="ghost" size="sm" onClick={() => void onRevokeInvitation(inv)} aria-label={`Revogar convite de ${inv.email}`}>
                  <X /> Revogar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover membro</DialogTitle>
            <DialogDescription>
              {removing ? `${removing.name} (${removing.email}) perderá o acesso imediato a este workspace e suas sessões aqui serão encerradas. Os documentos enviados permanecem.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void onRemove()} loading={removeMember.isPending}>
              Remover membro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie o link do convite:", url);
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} aria-label="Copiar link do convite">
      <Copy /> {copied ? "Copiado" : "Copiar link"}
    </Button>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <InviteForm onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function InviteForm({ onClose }: { onClose: () => void }) {
  const create = useCreateInvitation();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("editor");
  const [touched, setTouched] = React.useState(false);
  const [created, setCreated] = React.useState<Invitation | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    try {
      const inv = await create.mutateAsync({ email: email.trim(), role });
      setCreated(inv);
    } catch {
      /* exibido abaixo */
    }
  };

  if (created) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>Convite criado</DialogTitle>
          <DialogDescription>
            {created.email} foi convidado como {ROLE_LABELS[created.role].toLowerCase()}. O convite expira em {formatDate(created.expires_at)}.
          </DialogDescription>
        </DialogHeader>
        {created.accept_url ? (
          <div className="space-y-2">
            <Label htmlFor="accept-url">Link de aceite</Label>
            <div className="flex gap-2">
              <Input id="accept-url" readOnly value={created.accept_url} onFocus={(e) => e.currentTarget.select()} />
              <CopyLinkButton url={created.accept_url} />
            </div>
            <p className="text-xs text-muted-foreground">
              Envie este link ao convidado. Se o servidor tiver e-mail configurado, ele também recebe o convite por e-mail.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">O convite foi enviado por e-mail.</p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Concluir</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>Convidar membro</DialogTitle>
        <DialogDescription>O convidado precisa criar uma conta (ou entrar) com o mesmo e-mail para aceitar.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">E-mail</Label>
        <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} placeholder="pessoa@empresa.com" autoFocus aria-invalid={touched && !valid} />
        {touched && !valid ? <p className="text-xs text-destructive" role="alert">Informe um e-mail válido.</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-role">Papel</Label>
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger id="invite-role" aria-label="Papel do convidado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
      </div>
      {create.error ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(create.error)}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="gradient" loading={create.isPending}>
          Enviar convite
        </Button>
      </DialogFooter>
    </form>
  );
}
