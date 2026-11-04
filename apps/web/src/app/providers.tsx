import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/hooks/useTheme";
import { createQueryClient } from "./query-client";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
