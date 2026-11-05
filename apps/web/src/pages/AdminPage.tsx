import { NavLink, Navigate, useParams } from "react-router";
import { ClipboardList, Cpu, Gauge, ShieldOff, Timer, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { useMe } from "@/features/auth/hooks";
import { AuditPanel } from "@/features/admin/AuditPanel";
import { LimitsForm } from "@/features/admin/LimitsForm";
import { MembersPanel } from "@/features/admin/MembersPanel";
import { ProvidersPanel } from "@/features/admin/ProvidersPanel";
import { RetentionForm } from "@/features/admin/RetentionForm";
import { UsagePanel } from "@/features/admin/UsagePanel";
import { cn } from "@/lib/utils";

export const ADMIN_SECTIONS = [
  { id: "members", label: "Membros", icon: Users },
  { id: "usage", label: "Uso", icon: Gauge },
  { id: "limits", label: "Limites e custos", icon: Wallet },
  { id: "retention", label: "Retenção", icon: Timer },
  { id: "providers", label: "Provedores de IA", icon: Cpu },
  { id: "audit", label: "Auditoria", icon: ClipboardList },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["id"];

export function AdminPage() {
  const { section } = useParams();
  const { data: user } = useMe();
  const isAdmin = user?.workspace.role === "admin";

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Administração" />
        <EmptyState icon={ShieldOff} title="Acesso restrito a administradores" description="Seu papel neste workspace não permite acessar a administração. Peça a um administrador se precisar de acesso." />
      </div>
    );
  }

  const active = ADMIN_SECTIONS.find((s) => s.id === section);
  if (!active) return <Navigate to="/admin/members" replace />;

  return (
    <div>
      <PageHeader title="Administração" description="Membros, uso, limites, retenção, provedores de IA e auditoria do workspace." />
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Seções da administração" className="flex gap-1 overflow-x-auto lg:flex-col">
          {ADMIN_SECTIONS.map((s) => (
            <NavLink
              key={s.id}
              to={`/admin/${s.id}`}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <s.icon className="size-4" aria-hidden /> {s.label}
            </NavLink>
          ))}
        </nav>
        <Card>
          <CardContent className="pt-6">
            {active.id === "members" ? <MembersPanel /> : null}
            {active.id === "usage" ? <UsagePanel /> : null}
            {active.id === "limits" ? <LimitsForm /> : null}
            {active.id === "retention" ? <RetentionForm /> : null}
            {active.id === "providers" ? <ProvidersPanel /> : null}
            {active.id === "audit" ? <AuditPanel /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
