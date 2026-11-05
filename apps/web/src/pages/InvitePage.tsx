import { Link, useNavigate, useParams } from "react-router";
import { AlertCircle, Building2, CheckCircle2, LogIn, UserPlus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/hooks";
import { useAcceptInvitation, useInvitation } from "@/features/workspaces/hooks";
import { errorMessage, isApiError } from "@/services/api";
import { formatDate } from "@/lib/utils";
import { ROLE_LABELS } from "@/types/api";

const STATUS_MESSAGE: Record<string, string> = {
  accepted: "Este convite já foi aceito.",
  revoked: "Este convite foi revogado pelo administrador do workspace.",
  expired: "Este convite expirou. Peça um novo convite ao administrador.",
};

export function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { data: user, isPending: mePending } = useMe();
  const invitation = useInvitation(token || undefined);
  const accept = useAcceptInvitation();

  const next = `/invite/${encodeURIComponent(token)}`;

  const onAccept = async () => {
    try {
      await accept.mutateAsync(token);
      navigate("/", { replace: true });
    } catch {
      /* exibido abaixo */
    }
  };

  const emailMismatch = !!user && !!invitation.data && user.email.toLowerCase() !== invitation.data.email.toLowerCase();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex items-center justify-between p-4">
        <Logo />
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm animate-slide-up">
          <h1 className="text-xl font-semibold tracking-tight">Convite para workspace</h1>
          {!token ? (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle />
              <AlertDescription>Link de convite inválido.</AlertDescription>
            </Alert>
          ) : invitation.isPending || mePending ? (
            <div className="mt-4 space-y-2" role="status" aria-label="Carregando convite">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : invitation.isError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle />
              <AlertDescription>
                {isApiError(invitation.error) && invitation.error.status === 404 ? "Convite não encontrado ou inválido." : errorMessage(invitation.error)}
              </AlertDescription>
            </Alert>
          ) : invitation.data ? (
            <div className="mt-4 space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{invitation.data.workspace_name}</p>
                  <p className="text-sm text-muted-foreground">
                    Convite para <span className="font-medium text-foreground">{invitation.data.email}</span> como <Badge variant="purple">{ROLE_LABELS[invitation.data.role]}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">Expira em {formatDate(invitation.data.expires_at)}</p>
                </div>
              </div>

              {invitation.data.status !== "pending" ? (
                <Alert variant="warning">
                  <AlertCircle />
                  <AlertDescription>{STATUS_MESSAGE[invitation.data.status] ?? "Este convite não está mais disponível."}</AlertDescription>
                </Alert>
              ) : !user ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Entre ou crie uma conta com o e-mail convidado para aceitar.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button asChild variant="gradient">
                      <Link to={`/login?next=${encodeURIComponent(next)}`}>
                        <LogIn /> Entrar
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to={`/register?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invitation.data.email)}`}>
                        <UserPlus /> Criar conta
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : emailMismatch ? (
                <Alert variant="warning">
                  <AlertCircle />
                  <AlertDescription>
                    Você está conectado como <strong>{user.email}</strong>, mas o convite é para <strong>{invitation.data.email}</strong>. Saia e entre com a conta convidada.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {accept.error ? (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertDescription>{errorMessage(accept.error)}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button variant="gradient" className="w-full" onClick={() => void onAccept()} loading={accept.isPending}>
                    <CheckCircle2 /> Aceitar convite
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">Ao aceitar, sua sessão passa para este workspace.</p>
                </div>
              )}
            </div>
          ) : null}
          <p className="mt-6 text-center text-sm">
            <Link to="/" className="font-medium text-primary hover:underline">
              Ir para o início
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
