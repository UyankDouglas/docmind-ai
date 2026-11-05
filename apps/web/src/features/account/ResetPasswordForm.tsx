import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router";
import { z } from "zod";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, isApiError } from "@/services/api";
import { useResetPassword } from "./hooks";

const schema = z
  .object({
    password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres.").max(128, "Senha muito longa."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "As senhas não coincidem.", path: ["confirm"] });
type FormValues = z.infer<typeof schema>;

export function ResetPasswordForm() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useResetPassword();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          Link inválido: o token de redefinição não foi encontrado.{" "}
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Solicitar um novo link
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }

  if (reset.isSuccess) {
    return (
      <div className="space-y-4" role="status">
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>Senha redefinida. Todas as sessões anteriores foram encerradas por segurança.</AlertDescription>
        </Alert>
        <Button asChild variant="gradient" className="w-full">
          <Link to="/login">Entrar com a nova senha</Link>
        </Button>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await reset.mutateAsync({ token, password });
    } catch {
      /* exibido abaixo */
    }
  });

  const serverError = reset.error
    ? isApiError(reset.error) && (reset.error.status === 400 || reset.error.status === 404 || reset.error.status === 410)
      ? "Este link é inválido ou expirou. Solicite um novo."
      : errorMessage(reset.error)
    : null;
  const err = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {serverError}{" "}
            <Link to="/forgot-password" className="font-medium text-primary hover:underline">
              Solicitar novo link
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="password">Nova senha</Label>
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!err.password} {...form.register("password")} />
        {err.password ? <p className="text-xs text-destructive" role="alert">{err.password.message}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirmar nova senha</Label>
        <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!err.confirm} {...form.register("confirm")} />
        {err.confirm ? <p className="text-xs text-destructive" role="alert">{err.confirm.message}</p> : null}
      </div>
      <Button type="submit" variant="gradient" className="w-full" loading={reset.isPending}>
        Redefinir senha
      </Button>
    </form>
  );
}
