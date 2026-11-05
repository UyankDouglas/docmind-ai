import { Link } from "react-router";
import { Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RegisterForm } from "@/features/auth/RegisterForm";
import { useInstance } from "@/features/instance/hooks";

export function RegisterPage() {
  const instance = useInstance();
  const closed = instance.data?.registration_enabled === false;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Criar sua conta</h1>
      {closed ? (
        <Alert variant="info" className="mt-6" data-testid="registration-closed">
          <Lock />
          <AlertTitle>Cadastro desativado</AlertTitle>
          <AlertDescription>
            Esta instância não aceita novos cadastros. Peça um convite a um administrador ou{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              entre com uma conta existente
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Um workspace pessoal será criado automaticamente para você.
          </p>
          <RegisterForm />
        </>
      )}
    </div>
  );
}
