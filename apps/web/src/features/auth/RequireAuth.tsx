import { Navigate, Outlet, useLocation } from "react-router";
import { Logo } from "@/components/Logo";
import { ErrorState } from "@/components/ErrorState";
import { useMe } from "./hooks";

export function FullPageLoader({ label = "Carregando" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label={label}>
      <div className="flex flex-col items-center gap-4">
        <Logo size="lg" />
        <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 rounded-full bg-gradient-brand animate-[slide_1.2s_ease-in-out_infinite]" />
        </div>
      </div>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}`}</style>
    </div>
  );
}

export function RequireAuth() {
  const { data: user, isPending, isError, error, refetch } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageLoader />;
  if (isError) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState error={error} onRetry={() => void refetch()} title="Não foi possível verificar sua sessão" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Aceita só caminhos internos (evita open redirect via `?next=`). */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function RedirectIfAuthenticated() {
  const { data: user, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <FullPageLoader />;
  if (user) {
    const next = safeNext(new URLSearchParams(location.search).get("next"));
    return <Navigate to={next} replace />;
  }
  return <Outlet />;
}
