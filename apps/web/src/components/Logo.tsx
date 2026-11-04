import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoProps {
  collapsed?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function Logo({ collapsed = false, className, size = "md" }: LogoProps) {
  const box = size === "lg" ? "size-11" : size === "sm" ? "size-7" : "size-9";
  const icon = size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-lg";
  return (
    <div className={cn("flex items-center gap-2.5", className)} aria-label="DocMind AI">
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-white shadow-md",
          box,
        )}
        aria-hidden
      >
        <BrainCircuit className={icon} />
      </span>
      {!collapsed ? (
        <span className={cn("font-semibold tracking-tight", text)}>
          Doc<span className="text-gradient">Mind</span> <span className="font-normal text-muted-foreground">AI</span>
        </span>
      ) : null}
    </div>
  );
}
