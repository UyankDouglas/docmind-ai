import { http } from "@/services/api";
import type { AiStatus, Health, Member, Usage, Workspace } from "@/types/api";

export const settingsApi = {
  ai: (signal?: AbortSignal) => http.get<AiStatus>("/settings/ai", undefined, signal),
  health: (signal?: AbortSignal) => http.get<Health>("/health", undefined, signal),
  usage: (signal?: AbortSignal) => http.get<Usage>("/usage", undefined, signal),
  workspace: (signal?: AbortSignal) => http.get<Workspace>("/workspaces/current", undefined, signal),
  members: (signal?: AbortSignal) => http.get<{ items: Member[] }>("/workspaces/current/members", undefined, signal),
};
