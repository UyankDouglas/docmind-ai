import { Outlet } from "react-router";
import { FileSearch, Quote, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DemoBanner } from "@/features/instance/DemoBanner";

const highlights = [
  { icon: FileSearch, title: "Busca por significado", text: "Encontre informações mesmo quando a pergunta usa termos diferentes do documento." },
  { icon: Quote, title: "Respostas com fontes", text: "Cada resposta aponta para o documento e a página que a fundamentam." },
  { icon: ShieldCheck, title: "Privacidade por padrão", text: "Isolamento por workspace, armazenamento privado e auditoria." },
];

export function AuthLayout() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-primary/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-40 -right-20 size-[28rem] rounded-full bg-cyan/10 blur-3xl"
          aria-hidden
        />
        <Logo size="lg" className="relative" />
        <div className="relative space-y-8">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="size-3.5" /> Inteligência documental com RAG
            </p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight">
              Transforme documentos estáticos em uma base de conhecimento consultável.
            </h2>
          </div>
          <ul className="space-y-5">
            {highlights.map((h) => (
              <li key={h.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-card text-primary">
                  <h.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{h.title}</p>
                  <p className="text-sm text-muted-foreground">{h.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted-foreground">© {new Date().getFullYear()} DocMind AI</p>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-12">
          <div className="w-full max-w-md animate-slide-up">
            <DemoBanner className="mb-6" />
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
