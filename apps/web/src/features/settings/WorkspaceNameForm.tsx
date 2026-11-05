import * as React from "react";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useRenameWorkspace } from "@/features/workspaces/hooks";
import { errorMessage } from "@/services/api";

export function WorkspaceNameForm({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(name);
  const rename = useRenameWorkspace();
  const { toast } = useToast();

  if (!isAdmin) return <span className="font-medium">{name}</span>;
  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        <span className="font-medium">{name}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => { setValue(name); setEditing(true); }} aria-label="Renomear workspace">
          <Pencil />
        </Button>
      </span>
    );
  }

  const trimmed = value.trim();
  const invalid = trimmed.length < 2 || trimmed.length > 120;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    try {
      await rename.mutateAsync(trimmed);
      toast({ kind: "success", title: "Workspace renomeado" });
      setEditing(false);
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível renomear", description: errorMessage(err) });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="workspace-name" className="sr-only">
          Nome do workspace
        </Label>
        <Input id="workspace-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus aria-invalid={invalid} className="h-8" />
      </div>
      <Button type="submit" size="sm" loading={rename.isPending} disabled={invalid || trimmed === name}>
        <Save /> Salvar
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancelar
      </Button>
    </form>
  );
}
