import { ForgotPasswordForm } from "@/features/account/ForgotPasswordForm";

export function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Recuperar senha</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Informe o e-mail da sua conta para receber um link de redefinição.</p>
      <ForgotPasswordForm />
    </div>
  );
}
