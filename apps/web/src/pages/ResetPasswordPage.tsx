import { ResetPasswordForm } from "@/features/account/ResetPasswordForm";

export function ResetPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Definir nova senha</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Escolha uma senha com pelo menos 8 caracteres.</p>
      <ResetPasswordForm />
    </div>
  );
}
