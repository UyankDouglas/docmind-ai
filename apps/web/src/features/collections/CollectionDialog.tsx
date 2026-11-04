import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Collection } from "@/types/api";
import type { CollectionInput } from "./api";

export const COLLECTION_COLORS = ["#8B5CF6", "#6366F1", "#3B82F6", "#22D3EE", "#10B981", "#F59E0B", "#EF4444", "#EC4899"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection?: Collection | null;
  onSubmit: (input: CollectionInput) => Promise<void>;
  pending?: boolean;
  error?: string | null;
}

export function CollectionDialog({ open, onOpenChange, collection, onSubmit, pending, error }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* O conteúdo é desmontado ao fechar; o formulário reinicia seus valores a cada abertura. */}
        <CollectionForm collection={collection ?? null} onSubmit={onSubmit} pending={pending} error={error} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CollectionForm({
  collection,
  onSubmit,
  pending,
  error,
  onCancel,
}: {
  collection: Collection | null;
  onSubmit: (input: CollectionInput) => Promise<void>;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(collection?.name ?? "");
  const [description, setDescription] = React.useState(collection?.description ?? "");
  const [color, setColor] = React.useState<string | null>(collection?.color ?? null);
  const [touched, setTouched] = React.useState(false);

  const trimmed = name.trim();
  const invalid = trimmed.length < 2 || trimmed.length > 80;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    await onSubmit({ name: trimmed, description: description.trim() || null, color });
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{collection ? "Renomear coleção" : "Nova coleção"}</DialogTitle>
        <DialogDescription>Coleções organizam documentos e podem ser usadas como escopo no chat e na pesquisa.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="collection-name">Nome</Label>
        <Input
          id="collection-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="Ex.: Contratos 2026"
          autoFocus
          aria-invalid={touched && invalid}
          maxLength={80}
        />
        {touched && invalid ? <p className="text-xs text-destructive">Informe um nome com 2 a 80 caracteres.</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="collection-description">Descrição (opcional)</Label>
        <Textarea id="collection-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Cor (opcional)</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da coleção">
          <button
            type="button"
            role="radio"
            aria-checked={color === null}
            aria-label="Sem cor"
            onClick={() => setColor(null)}
            className={cn("size-7 rounded-full border-2 border-dashed border-border", color === null && "ring-2 ring-ring ring-offset-2 ring-offset-card")}
          />
          {COLLECTION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Cor ${c}`}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={cn("size-7 rounded-full border border-black/10", color === c && "ring-2 ring-ring ring-offset-2 ring-offset-card")}
            />
          ))}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="gradient" loading={pending}>
          {collection ? "Salvar" : "Criar coleção"}
        </Button>
      </DialogFooter>
    </form>
  );
}
