import * as React from "react";
import { SendHorizonal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  pending?: boolean;
  placeholder?: string;
  maxChars?: number;
  hint?: string;
  /** quando informado e `pending`, mostra o botão Parar (aborta o streaming) */
  onStop?: () => void;
}

export function ChatComposer({ onSend, disabled, pending, placeholder, maxChars = 2000, hint, onStop }: Props) {
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || pending) return;
    onSend(text);
    setValue("");
    ref.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const over = value.length > maxChars;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/60"
    >
      <label htmlFor="chat-input" className="sr-only">
        Sua pergunta
      </label>
      <Textarea
        id="chat-input"
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? "Pergunte algo sobre os documentos selecionados…"}
        disabled={disabled}
        rows={1}
        className="min-h-[44px] resize-none border-0 bg-transparent px-2 shadow-none focus-visible:outline-0"
        aria-invalid={over}
      />
      <div className="flex items-center justify-between px-2 pb-1">
        <span className={over ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {hint ?? "Enter envia · Shift+Enter quebra linha"}
          {value.length > maxChars * 0.8 ? ` · ${value.length}/${maxChars}` : ""}
        </span>
        {pending && onStop ? (
          <Button type="button" size="sm" variant="outline" onClick={onStop} aria-label="Parar geração">
            <Square className="size-3.5" /> Parar
          </Button>
        ) : (
          <Button type="submit" size="sm" variant="gradient" disabled={disabled || !value.trim() || over} loading={pending} aria-label="Enviar pergunta">
            {!pending ? <SendHorizonal /> : null} Enviar
          </Button>
        )}
      </div>
    </form>
  );
}
