import { http } from "@/services/api";
import type {
  AiStatus,
  Health,
  Member,
  RetrievalSettings,
  UsageFull,
  Workspace,
  WorkspaceLimits,
  WorkspaceRetention,
  WorkspaceSettingsFull,
} from "@/types/api";

export interface WorkspaceSettingsPatch {
  external_ai_enabled?: boolean;
  retrieval?: Partial<RetrievalSettings>;
  limits?: Partial<WorkspaceLimits>;
  retention?: Partial<Omit<WorkspaceRetention, "last_run_at">>;
  ai?: { llm_model?: string | null; ocr_enabled?: boolean };
}

export const settingsApi = {
  ai: (signal?: AbortSignal) => http.get<AiStatus>("/settings/ai", undefined, signal),
  health: (signal?: AbortSignal) => http.get<Health>("/health", undefined, signal),
  usage: (signal?: AbortSignal) => http.get<UsageFull>("/usage", undefined, signal),
  workspace: (signal?: AbortSignal) => http.get<Workspace>("/workspaces/current", undefined, signal),
  members: (signal?: AbortSignal) => http.get<{ items: Member[] }>("/workspaces/current/members", undefined, signal),
  workspaceSettings: (signal?: AbortSignal) =>
    http.get<WorkspaceSettingsFull>("/workspaces/current/settings", undefined, signal),
  updateWorkspaceSettings: (patch: WorkspaceSettingsPatch) =>
    http.patch<WorkspaceSettingsFull>("/workspaces/current/settings", patch),
};
