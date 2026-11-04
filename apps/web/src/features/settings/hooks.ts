import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceSettings } from "@/types/api";
import { settingsApi, type WorkspaceSettingsPatch } from "./api";

export const settingsKeys = {
  workspaceSettings: ["workspace", "settings"] as const,
};

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

export function useWorkspaceSettings() {
  return useQuery({
    queryKey: settingsKeys.workspaceSettings,
    queryFn: ({ signal }) => settingsApi.workspaceSettings(signal),
    staleTime: 60_000,
  });
}

export function useUpdateWorkspaceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: WorkspaceSettingsPatch) => settingsApi.updateWorkspaceSettings(patch),
    onSuccess: (data: WorkspaceSettings) => {
      qc.setQueryData(settingsKeys.workspaceSettings, data);
      void qc.invalidateQueries({ queryKey: ["workspace", "current"] });
      void qc.invalidateQueries({ queryKey: ["settings", "ai"] });
    },
  });
}
