import { http } from "@/services/api";
import type { Invitation, InvitationPublic, Member, Role, UserMe, Workspace, WorkspaceMembership } from "@/types/api";

export const workspacesApi = {
  list: (signal?: AbortSignal) => http.get<{ items: WorkspaceMembership[] }>("/workspaces", undefined, signal),
  switch: (workspace_id: string) => http.post<UserMe>("/workspaces/switch", { workspace_id }),
  rename: (name: string) => http.patch<Workspace>("/workspaces/current", { name }),
  updateMemberRole: (userId: string, role: Role) => http.patch<Member>(`/workspaces/current/members/${userId}`, { role }),
  removeMember: (userId: string) => http.delete(`/workspaces/current/members/${userId}`),
  invitations: (signal?: AbortSignal) =>
    http.get<{ items: Invitation[] }>("/workspaces/current/invitations", undefined, signal),
  createInvitation: (email: string, role: Role) => http.post<Invitation>("/workspaces/current/invitations", { email, role }),
  revokeInvitation: (id: string) => http.delete(`/workspaces/current/invitations/${id}`),
  invitation: (token: string, signal?: AbortSignal) =>
    http.get<InvitationPublic>(`/invitations/${encodeURIComponent(token)}`, undefined, signal),
  acceptInvitation: (token: string) => http.post<UserMe>(`/invitations/${encodeURIComponent(token)}/accept`),
};
