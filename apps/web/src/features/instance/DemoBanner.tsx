import { FlaskConical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { cn } from "@/lib/utils";
import { useInstance } from "./hooks";

/**
 * Aviso da demonstração pública. Na tela de login ele é fixo; dentro do app pode ser recolhido
 * (fica salvo no navegador), já que o aviso de privacidade do provedor continua no chat.
 */
export function DemoBanner({ dismissible = false, className }: { dismissible?: boolean; className?: string }) {
  const { data } = useInstance();
  const [dismissed, setDismissed] = useLocalStorage("docmind:demo-banner-dismissed", false);
  if (!data?.demo_mode || !data.demo_notice) return null;
  if (dismissible && dismissed) return null;
  return (
    <div
      role="note"
      data-testid="demo-banner"
      className={cn(
        "flex items-start gap-3 border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-foreground",
        dismissible ? "border-b" : "rounded-lg border",
        className,
      )}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="flex-1">
        <span className="font-medium">Ambiente de demonstração.</span> {data.demo_notice}
      </p>
      {dismissible ? (
        <Button
          variant="ghost"
          size="icon"
          className="-my-1 size-7 shrink-0"
          onClick={() => setDismissed(true)}
          aria-label="Ocultar aviso de demonstração"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
