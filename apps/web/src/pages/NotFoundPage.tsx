import { Link } from "react-router";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <FileQuestion className="size-8" aria-hidden />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Página não encontrada</h1>
        <p className="mt-1 text-sm text-muted-foreground">O endereço acessado não existe ou foi movido.</p>
      </div>
      <Button asChild>
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}
