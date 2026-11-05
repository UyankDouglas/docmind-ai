import { FileStack } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useMe } from "@/features/auth/hooks";
import { errorMessage } from "@/services/api";
import { useInstance, useLoadDemoSamples } from "./hooks";

/** Envia os documentos fictícios de exemplo ao workspace atual (só no modo demonstração). */
export function LoadSamplesButton({ variant = "outline", size, className }: Pick<ButtonProps, "variant" | "size" | "className">) {
  const { data } = useInstance();
  const { data: user } = useMe();
  const load = useLoadDemoSamples();
  const { toast } = useToast();
  const canWrite = user?.workspace.role === "admin" || user?.workspace.role === "editor";
  if (!data?.demo_samples_available || !canWrite) return null;

  const onClick = async () => {
    try {
      const result = await load.mutateAsync();
      if (result.loaded.length > 0) {
        toast({
          kind: "success",
          title: `${result.loaded.length} documento(s) de exemplo enviados`,
          description: result.stopped_reason
            ? result.stopped_reason
            : "Eles aparecem na coleção \"Documentos de exemplo\" e ficam prontos em alguns segundos.",
        });
      } else {
        toast({
          kind: "info",
          title: "Os documentos de exemplo já estão no workspace",
          description: result.stopped_reason ?? undefined,
        });
      }
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível carregar os exemplos", description: errorMessage(e) });
    }
  };

  return (
    <Button variant={variant} size={size} className={className} onClick={() => void onClick()} disabled={load.isPending}>
      <FileStack /> {load.isPending ? "Enviando exemplos…" : "Carregar documentos de exemplo"}
    </Button>
  );
}
