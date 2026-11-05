import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUsage } from "@/features/settings/hooks";
import { formatDate } from "@/lib/utils";
import type { AdminUsageByDay } from "@/types/api";
import { useAdminUsage } from "./hooks";

const PERIODS = [7, 30, 90] as const;

export const fmtInt = (n: number) => n.toLocaleString("pt-BR");
export const fmtCost = (n: number | null) => (n == null ? "Sem estimativa" : `US$ ${n.toFixed(4)}`);
export const fmtMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`);

export function UsagePanel() {
  const [days, setDays] = React.useState<number>(30);
  const admin = useAdminUsage(days);
  const usage = useUsage();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Uso do workspace</h2>
          <p className="text-sm text-muted-foreground">Perguntas, uploads, tokens e custo estimado (quando há preços configurados) por usuário e por dia.</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-40" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={String(p)}>
                Últimos {p} dias
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {usage.data?.limits.monthly_token_budget != null ? (
        <BudgetBar used={usage.data.tokens_month_total} budget={usage.data.limits.monthly_token_budget} pct={usage.data.budget_used_pct} />
      ) : null}

      {admin.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : admin.isError || !admin.data ? (
        <ErrorState error={admin.error} onRetry={() => void admin.refetch()} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Período: {formatDate(admin.data.period_start)} a {formatDate(admin.data.period_end)}
          </p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="usage-totals">
            <Stat label="Perguntas" value={fmtInt(admin.data.totals.questions)} />
            <Stat label="Uploads" value={fmtInt(admin.data.totals.uploads)} />
            <Stat label="Tokens" value={fmtInt(admin.data.totals.prompt_tokens + admin.data.totals.completion_tokens)} hint={`${fmtInt(admin.data.totals.prompt_tokens)} entrada · ${fmtInt(admin.data.totals.completion_tokens)} saída`} />
            <Stat label="Custo estimado" value={fmtCost(admin.data.totals.estimated_cost_usd)} />
            <Stat label="Documentos" value={fmtInt(admin.data.totals.documents)} />
            <Stat label="Armazenamento" value={fmtMb(admin.data.totals.storage_mb)} />
          </div>

          <DailyChart days={admin.data.by_day} />

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Uso por usuário</caption>
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Usuário</th>
                  <th scope="col" className="px-3 py-2 text-right">Perguntas</th>
                  <th scope="col" className="px-3 py-2 text-right">Uploads</th>
                  <th scope="col" className="px-3 py-2 text-right">Tokens entrada</th>
                  <th scope="col" className="px-3 py-2 text-right">Tokens saída</th>
                  <th scope="col" className="px-3 py-2 text-right">Custo est.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {admin.data.by_user.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Sem uso registrado no período.
                    </td>
                  </tr>
                ) : (
                  admin.data.by_user.map((u) => (
                    <tr key={u.user_id}>
                      <td className="px-3 py-2">
                        <span className="block font-medium">{u.name}</span>
                        <span className="block text-xs text-muted-foreground">{u.email}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(u.questions)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(u.uploads)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(u.prompt_tokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(u.completion_tokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCost(u.estimated_cost_usd)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function BudgetBar({ used, budget, pct }: { used: number; budget: number; pct: number | null }) {
  const percent = Math.min(100, Math.max(0, pct ?? (budget > 0 ? (used / budget) * 100 : 0)));
  const tone = percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-warning" : "bg-primary";
  return (
    <div className="rounded-lg border border-border p-3" data-testid="budget-bar">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Orçamento mensal de tokens</span>
        <span>
          {fmtInt(used)} / {fmtInt(budget)} ({percent.toFixed(0)}%)
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Uso do orçamento mensal de tokens">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function DailyChart({ days }: { days: AdminUsageByDay[] }) {
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => d.prompt_tokens + d.completion_tokens));
  const width = Math.max(240, days.length * 14);
  const height = 96;
  return (
    <figure className="rounded-lg border border-border p-3">
      <figcaption className="mb-2 text-xs text-muted-foreground">Tokens por dia (entrada + saída)</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label={`Tokens por dia em ${days.length} dias`}>
        {days.map((d, i) => {
          const total = d.prompt_tokens + d.completion_tokens;
          const h = Math.round((total / max) * (height - 16));
          const x = i * (width / days.length);
          const w = Math.max(2, width / days.length - 3);
          return (
            <g key={d.day}>
              <title>{`${formatDate(d.day)}: ${fmtInt(total)} tokens · ${d.questions} pergunta(s)`}</title>
              <rect x={x} y={height - h} width={w} height={h} rx={1.5} className="fill-primary/70" />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatDate(days[0]!.day)}</span>
        <span>{formatDate(days[days.length - 1]!.day)}</span>
      </div>
    </figure>
  );
}
