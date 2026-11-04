import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagsEditor } from "@/components/TagsEditor";
import { useCollections } from "@/features/collections/hooks";
import type { DocumentItem } from "@/types/api";
import type { DocumentPatch } from "./api";
import { useDocumentTags } from "./hooks";

interface BaseProps {
  doc: DocumentItem | null;
  onClose: () => void;
  onSubmit: (patch: DocumentPatch) => Promise<void>;
  pending?: boolean;
}

// Os formulários internos são desmontados quando o Dialog fecha; assim os valores iniciais
// vêm de `useState(doc...)` sem efeitos de sincronização.

export function RenameDocumentDialog({ doc, onClose, onSubmit, pending }: BaseProps) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{doc ? <RenameForm doc={doc} onClose={onClose} onSubmit={onSubmit} pending={pending} /> : null}</DialogContent>
    </Dialog>
  );
}

function RenameForm({ doc, onClose, onSubmit, pending }: BaseProps & { doc: DocumentItem }) {
  const [name, setName] = React.useState(doc.name);
  const trimmed = name.trim();
  const invalid = trimmed.length < 1 || trimmed.length > 255;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) void onSubmit({ name: trimmed });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Renomear documento</DialogTitle>
        <DialogDescription>O nome original do arquivo é preservado nos metadados.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="doc-rename">Nome</Label>
        <Input id="doc-rename" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={255} aria-invalid={invalid} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="gradient" loading={pending} disabled={invalid}>
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditTagsDialog({ doc, onClose, onSubmit, pending }: BaseProps) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{doc ? <TagsForm doc={doc} onClose={onClose} onSubmit={onSubmit} pending={pending} /> : null}</DialogContent>
    </Dialog>
  );
}

function TagsForm({ doc, onClose, onSubmit, pending }: BaseProps & { doc: DocumentItem }) {
  const [tags, setTags] = React.useState<string[]>(doc.tags ?? []);
  const known = useDocumentTags();
  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar tags</DialogTitle>
        <DialogDescription>{doc.name}</DialogDescription>
      </DialogHeader>
      <TagsEditor value={tags} onChange={setTags} suggestions={(known.data ?? []).map((t) => t.tag)} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="gradient" loading={pending} onClick={() => void onSubmit({ tags })}>
          Salvar tags
        </Button>
      </DialogFooter>
    </>
  );
}

export function MoveToCollectionDialog({ doc, onClose, onSubmit, pending }: BaseProps) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{doc ? <MoveForm doc={doc} onClose={onClose} onSubmit={onSubmit} pending={pending} /> : null}</DialogContent>
    </Dialog>
  );
}

function MoveForm({ doc, onClose, onSubmit, pending }: BaseProps & { doc: DocumentItem }) {
  const collections = useCollections();
  const [value, setValue] = React.useState<string>(doc.collection_id ?? "none");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Mover para coleção</DialogTitle>
        <DialogDescription>{doc.name}</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="doc-collection">Coleção</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id="doc-collection" aria-label="Coleção de destino">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem coleção</SelectItem>
            {(collections.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {collections.data && collections.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma coleção criada ainda. Crie uma no painel de coleções.</p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="gradient" loading={pending} onClick={() => void onSubmit({ collection_id: value === "none" ? null : value })}>
          Mover
        </Button>
      </DialogFooter>
    </>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={destructive ? "destructive" : "gradient"} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
