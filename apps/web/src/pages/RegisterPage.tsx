import { RegisterForm } from "@/features/auth/RegisterForm";

export function RegisterPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Criar sua conta</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Um workspace pessoal será criado automaticamente para você.
      </p>
      <RegisterForm />
    </div>
  );
}
