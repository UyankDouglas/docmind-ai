import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { errorMessage, isApiError } from "@/services/api";
import { useInstance } from "@/features/instance/hooks";
import { useLogin } from "./hooks";
import { safeNext } from "./RequireAuth";

const schema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const instance = useInstance();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const nextParam = new URLSearchParams(location.search).get("next");
  const from = safeNext(nextParam ?? (location.state as { from?: string } | null)?.from);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      navigate(from, { replace: true });
    } catch {
      /* erro exibido abaixo */
    }
  });

  const serverError = login.error
    ? isApiError(login.error) && login.error.status === 401
      ? "E-mail ou senha incorretos."
      : errorMessage(login.error)
    : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="voce@empresa.com"
          aria-invalid={!!form.formState.errors.email}
          {...form.register("email")}
        />
        {form.formState.errors.email ? (
          <p className="text-xs text-destructive" role="alert">
            {form.formState.errors.email.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-invalid={!!form.formState.errors.password}
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-xs text-destructive" role="alert">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="gradient" className="w-full" loading={login.isPending}>
        Entrar
      </Button>
      <p className="text-center text-sm">
        <Link to="/forgot-password" className="font-medium text-primary hover:underline">
          Esqueci minha senha
        </Link>
      </p>
      {instance.data?.registration_enabled === false ? null : (
        <p className="text-center text-sm text-muted-foreground">
          Ainda não tem conta?{" "}
          <Link to={nextParam ? `/register?next=${encodeURIComponent(nextParam)}` : "/register"} className="font-medium text-primary hover:underline">
            Criar conta
          </Link>
        </p>
      )}
    </form>
  );
}
