import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import { AlertCircle, MailCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/services/api";
import { useForgotPassword } from "./hooks";

const schema = z.object({ email: z.email("Informe um e-mail válido.") });
type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      await forgot.mutateAsync(email);
    } catch {
      /* exibido abaixo */
    }
  });

  if (forgot.isSuccess) {
    return (
      <div className="space-y-4" role="status">
        <Alert variant="success">
          <MailCheck />
          <AlertDescription>
            Se existir uma conta com este e-mail, enviaremos instruções para redefinir a senha. O link expira em pouco tempo.
          </AlertDescription>
        </Alert>
        {import.meta.env.DEV ? (
          <p className="text-xs text-muted-foreground">
            Ambiente de desenvolvimento: sem servidor de e-mail configurado, o link de redefinição é registrado no log do servidor da API.
          </p>
        ) : null}
        <Link to="/login" className="block text-center text-sm font-medium text-primary hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {forgot.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{errorMessage(forgot.error)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail da conta</Label>
        <Input id="email" type="email" autoComplete="email" placeholder="voce@empresa.com" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
        {form.formState.errors.email ? (
          <p className="text-xs text-destructive" role="alert">
            {form.formState.errors.email.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="gradient" className="w-full" loading={forgot.isPending}>
        Enviar instruções
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Lembrou a senha?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
