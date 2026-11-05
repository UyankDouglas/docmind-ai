import { Link } from "react-router";
import { Ban } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useMe } from "@/features/auth/hooks";
import { cn } from "@/lib/utils";
import { useUsage } from "./hooks";

/** Banner exibido quando o workspace atingiu um teto mensal (tokens, custo, documentos ou armazenamento). */
export function UsageBlockBanner({ className }: { className?: string }) {
  const usage = useUsage();
  const { data: user } = useMe();
  if (!usage.data?.blocked) return null;
  const isAdmin = user?.workspace.role === "admin";
  return (
    <Alert variant="warning" className={cn("mb-4", className)} data-testid="usage-block-banner">
      <Ban />
      <AlertTitle>Limite de uso do workspace atingido</AlertTitle>
      <AlertDescription>
        {usage.data.blocked_reason ?? "Um teto mensal configurado para este workspace foi atingido."}{" "}
        {isAdmin ? (
          <>
            Ajuste os limites em{" "}
            <Link to="/admin/limits" className="font-medium text-primary hover:underline">
              Administração › Limites e custos
            </Link>
            .
          </>
        ) : (
          "Fale com um administrador do workspace para ampliar os limites."
        )}
      </AlertDescription>
    </Alert>
  );
}
