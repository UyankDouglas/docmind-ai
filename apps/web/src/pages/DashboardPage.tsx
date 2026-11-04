import { Link } from "react-router";
import { ArrowRight, CheckCircle2, FileText, Folders, Loader2, MessageSquareText, Search, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardsSkeleton } from "@/components/Skeletons";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { AiStatusCard } from "@/features/settings/AiStatusCard";
import { useDocuments } from "@/features/documents/hooks";
import { useConversations } from "@/features/chat/hooks";
import { useCollections } from "@/features/collections/hooks";
import { CollectionColorDot } from "@/features/collections/CollectionsPanel";
import { documentKind, KIND_LABELS, type DocumentKind } from "@/lib/documents";
import { useMe } from "@/features/auth/hooks";
import { isProcessingStatus } from "@/types/api";
import { formatRelative } from "@/lib/utils";

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: number | string; icon: typeof FileText; tone: string }) {
  return (
    <Card className="animate-slide-up">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
        </div>
        <span className={`flex size-11 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="size-5" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data: user } = useMe();
  const docs = useDocuments({ page: 1, page_size: 100 });
  const convs = useConversations();
  const collections = useCollections();

  const items = docs.data?.items ?? [];
  const ready = items.filter((d) => d.status === "ready").length;
  const processing = items.filter((d) => isProcessingStatus(d.status)).length;
  const recent = items.slice(0, 5);
  const byKind = items.reduce<Record<DocumentKind, number>>(
    (acc, d) => {
      acc[documentKind(d.mime_type)] += 1;
      return acc;
    },
    { pdf: 0, docx: 0, txt: 0, other: 0 },
  );
  const recentCollections = (collections.data ?? []).slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`Olá, ${user?.name.split(" ")[0] ?? ""}`}
        description={`Workspace: ${user?.workspace.name ?? "—"}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/documents">
                <Upload /> Enviar documento
              </Link>
            </Button>
            <Button variant="gradient" asChild>
              <Link to="/chat">
                <MessageSquareText /> Nova conversa
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6">
        <AiStatusCard />
      </div>

      {docs.isPending ? (
        <CardsSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Documentos" value={docs.data?.total ?? 0} icon={FileText} tone="bg-primary/15 text-primary" />
          <StatCard title="Prontos para consulta" value={ready} icon={CheckCircle2} tone="bg-success/15 text-success" />
          <StatCard title="Em processamento" value={processing} icon={Loader2} tone="bg-info/15 text-info" />
          <StatCard title="Conversas" value={convs.data?.length ?? 0} icon={MessageSquareText} tone="bg-cyan/15 text-cyan" />
        </div>
      )}

      {!docs.isPending && items.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Documentos por tipo">
          {(["pdf", "docx", "txt"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs">
              <span className="font-semibold">{byKind[k]}</span> {KIND_LABELS[k]}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Documentos recentes</CardTitle>
              <CardDescription>Últimos arquivos enviados ao workspace.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/documents">
                Ver todos <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {docs.isPending ? null : recent.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Nenhum documento"
                description="Envie um PDF, DOCX ou TXT para começar."
                className="py-8"
                action={
                  <Button asChild size="sm">
                    <Link to="/documents">Enviar documento</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Link to={`/documents/${d.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                      {d.name}
                    </Link>
                    <span className="hidden text-xs text-muted-foreground sm:block">{formatRelative(d.created_at)}</span>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Coleções</CardTitle>
              <CardDescription>Agrupe documentos e use como escopo no chat.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/documents">
                <Folders /> Gerenciar
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {collections.isPending ? null : recentCollections.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma coleção ainda.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentCollections.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                    <CollectionColorDot color={c.color} />
                    <Link to={`/collections/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{c.document_count} doc.</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ações rápidas</CardTitle>
            <CardDescription>Atalhos para o fluxo principal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { to: "/documents", icon: Upload, label: "Enviar e indexar um documento" },
              { to: "/chat", icon: MessageSquareText, label: "Perguntar aos documentos" },
              { to: "/search", icon: Search, label: "Pesquisar trechos por significado" },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/50 hover:bg-accent/40"
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <a.icon className="size-4" aria-hidden />
                </span>
                <span className="flex-1">{a.label}</span>
                <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
