import { http } from "@/services/api";
import type { AiStatus, Health, Member, RetrievalSettings, Usage, Workspace, WorkspaceSettings } from "@/types/api";

export interface WorkspaceSettingsPatch {
  external_ai_enabled?: boolean;
  retrieval?: Partial<RetrievalSettings>;
}

export const settingsApi = {
  ai: (signal?: AbortSignal) => http.get<AiStatus>("/settings/ai", undefined, signal),
  health: (signal?: AbortSignal) => http.get<Health>("/health", undefined, signal),
  usage: (signal?: AbortSignal) => http.get<Usage>("/usage", undefined, signal),
  workspace: (signal?: AbortSignal) => http.get<Workspace>("/workspaces/current", undefined, signal),
  members: (signal?: AbortSignal) => http.get<{ items: Member[] }>("/workspaces/current/members", undefined, signal),
  workspaceSettings: (signal?: AbortSignal) =>
    http.get<WorkspaceSettings>("/workspaces/current/settings", undefined, signal),
  updateWorkspaceSettings: (patch: WorkspaceSettingsPatch) =>
    http.patch<WorkspaceSettings>("/workspaces/current/settings", patch),
};
