import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "./api";

export function useAiStatus() {
  return useQuery({
    queryKey: ["settings", "ai"],
    queryFn: ({ signal }) => settingsApi.ai(signal),
    staleTime: 5 * 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => settingsApi.health(signal),
    staleTime: 60_000,
  });
}

export function useUsage() {
  return useQuery({
    queryKey: ["usage"],
    queryFn: ({ signal }) => settingsApi.usage(signal),
  });
}

export function useWorkspace() {
  return useQuery({
    queryKey: ["workspace", "current"],
    queryFn: ({ signal }) => settingsApi.workspace(signal),
  });
}

export function useMembers() {
  return useQuery({
    queryKey: ["workspace", "members"],
    queryFn: ({ signal }) => settingsApi.members(signal),
    select: (d) => d.items,
  });
}
