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
import { useRegister } from "./hooks";
import { safeNext } from "./RequireAuth";

const schema = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome.").max(120, "Nome muito longo."),
    email: z.email("Informe um e-mail válido."),
    password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "As senhas não coincidem.", path: ["confirm"] });

type FormValues = z.infer<typeof schema>;

export function RegisterForm() {
  const register = useRegister();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const nextParam = params.get("next");
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: params.get("email") ?? "", password: "", confirm: "" },
  });

  const onSubmit = form.handleSubmit(async ({ name, email, password }) => {
    try {
      await register.mutateAsync({ name, email, password });
      navigate(safeNext(nextParam), { replace: true });
    } catch {
      /* exibido abaixo */
    }
  });

  const serverError = register.error
    ? isApiError(register.error) && register.error.status === 409
      ? "Já existe uma conta com este e-mail."
      : errorMessage(register.error)
    : null;

  const err = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" autoComplete="name" placeholder="Seu nome" aria-invalid={!!err.name} {...form.register("name")} />
        {err.name ? <p className="text-xs text-destructive" role="alert">{err.name.message}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="email" placeholder="voce@empresa.com" aria-invalid={!!err.email} {...form.register("email")} />
        {err.email ? <p className="text-xs text-destructive" role="alert">{err.email.message}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!err.password} {...form.register("password")} />
          {err.password ? <p className="text-xs text-destructive" role="alert">{err.password.message}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirmar senha</Label>
          <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!err.confirm} {...form.register("confirm")} />
          {err.confirm ? <p className="text-xs text-destructive" role="alert">{err.confirm.message}</p> : null}
        </div>
      </div>
      <Button type="submit" variant="gradient" className="w-full" loading={register.isPending}>
        Criar conta
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link to={nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : "/login"} className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
