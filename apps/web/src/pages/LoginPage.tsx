import { LoginForm } from "@/features/auth/LoginForm";

export function LoginPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Entre para consultar seus documentos.</p>
      <LoginForm />
    </div>
  );
}
