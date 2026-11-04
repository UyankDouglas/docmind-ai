import { Moon, SlidersHorizontal, Sun, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/hooks";
import { AiStatusCard } from "@/features/settings/AiStatusCard";
import { RetrievalSettingsCard } from "@/features/settings/RetrievalSettingsCard";
import { useAiStatus, useMembers, useUsage, useWorkspace } from "@/features/settings/hooks";
import { useTheme } from "@/hooks/useTheme";
import { formatDateTime, initials } from "@/lib/utils";

const ROLE_LABEL = { admin: "Administrador", editor: "Editor", viewer: "Visualizador" } as const;

export function SettingsPage() {
  const { data: user } = useMe();
  const workspace = useWorkspace();
  const members = useMembers();
  const usage = useUsage();
  const ai = useAiStatus();
  const { theme, setTheme } = useTheme();
  const isAdmin = workspace.data?.role === "admin";

  return (
    <div>
      <PageHeader title="Configurações" description="Perfil, workspace, recuperação, provedores de IA e uso." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>Dados da sua conta.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <span className="flex size-12 items-center justify-center rounded-full bg-gradient-brand text-sm font-semibold text-white">
              {user ? initials(user.name) : ""}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{user?.name}</p>
              <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
              <p className="text-xs text-muted-foreground">Conta criada em {formatDateTime(user?.created_at)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aparência</CardTitle>
            <CardDescription>O modo escuro é o padrão.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant={theme === "dark" ? "default" : "outline"} onClick={() => setTheme("dark")} aria-pressed={theme === "dark"}>
              <Moon /> Escuro
            </Button>
            <Button variant={theme === "light" ? "default" : "outline"} onClick={() => setTheme("light")} aria-pressed={theme === "light"}>
              <Sun /> Claro
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Isolamento de documentos, embeddings e conversas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspace.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : workspace.data ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Nome</dt>
                <dd className="font-medium">{workspace.data.name}</dd>
                <dt className="text-muted-foreground">Seu papel</dt>
                <dd>
                  <Badge variant="purple">{ROLE_LABEL[workspace.data.role]}</Badge>
                </dd>
                <dt className="text-muted-foreground">IA externa</dt>
                <dd>{workspace.data.settings.external_ai_enabled ? "Habilitada" : "Desabilitada"}</dd>
                <dt className="text-muted-foreground">Criado em</dt>
                <dd>{formatDateTime(workspace.data.created_at)}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Não foi possível carregar o workspace.</p>
            )}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Users className="size-3.5" aria-hidden /> Membros
              </h4>
              {members.isPending ? (
                <Skeleton className="h-8 w-full" />
              ) : members.data ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {members.data.map((m) => (
                    <li key={m.user_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">
                        {initials(m.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{m.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                      </span>
                      <Badge variant="muted">{ROLE_LABEL[m.role]}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Não foi possível listar os membros.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inteligência artificial e privacidade</CardTitle>
            <CardDescription>Provedores configurados no servidor e aviso sobre processamento externo.</CardDescription>
          </CardHeader>
          <CardContent>
            <AiStatusCard />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" aria-hidden /> Recuperação
            </CardTitle>
            <CardDescription>
              Como os trechos são buscados antes da geração: modo (híbrido ou vetorial), quantidade, limiar de similaridade e orçamento de contexto. Ajustes valem para todo o workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RetrievalSettingsCard isAdmin={isAdmin} privacyNotice={ai.data?.notice} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Uso e limites</CardTitle>
            <CardDescription>Valores de custo são estimativas quando exibidos.</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : usage.data ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <UsageStat label="Perguntas (última hora)" value={`${usage.data.questions_last_hour} / ${usage.data.limits.questions_per_hour}`} />
                <UsageStat label="Uploads (última hora)" value={`${usage.data.uploads_last_hour} / ${usage.data.limits.uploads_per_hour}`} />
                <UsageStat label="Tokens no mês" value={(usage.data.prompt_tokens_month + usage.data.completion_tokens_month).toLocaleString("pt-BR")} hint={`${usage.data.prompt_tokens_month.toLocaleString("pt-BR")} entrada · ${usage.data.completion_tokens_month.toLocaleString("pt-BR")} saída`} />
                <UsageStat
                  label="Custo estimado no mês"
                  value={usage.data.estimated_cost_usd_month == null ? "Sem estimativa" : `US$ ${usage.data.estimated_cost_usd_month.toFixed(4)}`}
                  hint={`Limites: ${usage.data.limits.max_upload_mb} MB por arquivo · ${usage.data.limits.max_pdf_pages} páginas por PDF`}
                />
                {usage.data.feedback ? (
                  <div className="rounded-lg border border-border p-4 sm:col-span-2 lg:col-span-4" data-testid="feedback-summary">
                    <p className="text-xs text-muted-foreground">Feedback das respostas</p>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                      <span className="inline-flex items-center gap-1 text-success">
                        <ThumbsUp className="size-4" aria-hidden /> {usage.data.feedback.positive} útil{usage.data.feedback.positive === 1 ? "" : "s"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <ThumbsDown className="size-4" aria-hidden /> {usage.data.feedback.negative} não útil{usage.data.feedback.negative === 1 ? "" : "s"}
                      </span>
                      <span className="text-muted-foreground">
                        de {usage.data.feedback.total_answers} resposta{usage.data.feedback.total_answers === 1 ? "" : "s"}
                        {usage.data.feedback.total_answers > 0
                          ? ` · ${Math.round(((usage.data.feedback.positive + usage.data.feedback.negative) / usage.data.feedback.total_answers) * 100)}% avaliadas`
                          : ""}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Não foi possível carregar o uso.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UsageStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
