import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { errorMessage, isApiError } from "@/services/api";
import { useChangePassword } from "./hooks";

const schema = z
  .object({
    current: z.string().min(1, "Informe a senha atual."),
    next: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres.").max(128, "Senha muito longa."),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "As senhas não coincidem.", path: ["confirm"] })
  .refine((v) => v.next !== v.current, { message: "A nova senha deve ser diferente da atual.", path: ["next"] });
type FormValues = z.infer<typeof schema>;

export function ChangePasswordCard() {
  const change = useChangePassword();
  const { toast } = useToast();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { current: "", next: "", confirm: "" } });
  const err = form.formState.errors;

  const onSubmit = form.handleSubmit(async ({ current, next }) => {
    try {
      await change.mutateAsync({ current, next });
      form.reset();
      toast({ kind: "success", title: "Senha alterada", description: "As outras sessões foram encerradas." });
    } catch (e) {
      const msg = isApiError(e) && (e.status === 401 || e.status === 403) ? "Senha atual incorreta." : errorMessage(e);
      form.setError("current", { message: msg });
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate aria-label="Alterar senha">
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Senha atual</Label>
        <Input id="current-password" type="password" autoComplete="current-password" aria-invalid={!!err.current} {...form.register("current")} />
        {err.current ? <p className="text-xs text-destructive" role="alert">{err.current.message}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">Nova senha</Label>
          <Input id="new-password" type="password" autoComplete="new-password" aria-invalid={!!err.next} {...form.register("next")} />
          {err.next ? <p className="text-xs text-destructive" role="alert">{err.next.message}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirmar nova senha</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" aria-invalid={!!err.confirm} {...form.register("confirm")} />
          {err.confirm ? <p className="text-xs text-destructive" role="alert">{err.confirm.message}</p> : null}
        </div>
      </div>
      <Button type="submit" variant="outline" loading={change.isPending}>
        <KeyRound /> Alterar senha
      </Button>
    </form>
  );
}
