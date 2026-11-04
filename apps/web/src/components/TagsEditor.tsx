import * as React from "react";
import { Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
}

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

/** Campo de tags com chips: Enter/vírgula adicionam, Backspace remove a última. */
export function TagsEditor({
  value,
  onChange,
  suggestions = [],
  placeholder = "Adicionar tag…",
  disabled,
  id,
  className,
  "aria-label": ariaLabel = "Tags",
}: Props) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag || value.includes(tag) || value.length >= MAX_TAGS) return;
    onChange([...value, tag]);
  };
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const commitDraft = () => {
    if (draft.trim()) {
      add(draft);
      setDraft("");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const available = suggestions.filter((s) => !value.includes(s) && (!draft || s.includes(draft.toLowerCase()))).slice(0, 8);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-within:outline-2 focus-within:outline-ring/40",
          disabled && "opacity-60",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Tag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary" data-testid="tag-chip">
            {tag}
            {!disabled ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(tag);
                }}
                className="rounded-full hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Remover tag ${tag}`}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          disabled={disabled || value.length >= MAX_TAGS}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
          placeholder={value.length ? "" : placeholder}
          aria-label={ariaLabel}
          className="min-w-[6rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
          maxLength={MAX_TAG_LENGTH}
        />
      </div>
      {available.length > 0 && !disabled ? (
        <div className="flex flex-wrap gap-1" aria-label="Sugestões de tags">
          {available.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                add(s);
                setDraft("");
              }}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              + {s}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">Enter ou vírgula para adicionar · até {MAX_TAGS} tags</p>
    </div>
  );
}
