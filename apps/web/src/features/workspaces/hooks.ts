import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authKeys } from "@/features/auth/hooks";
import type { Role, UserMe } from "@/types/api";
import { workspacesApi } from "./api";

export const workspaceKeys = {
  list: ["workspaces", "list"] as const,
  invitations: ["workspace", "invitations"] as const,
  invitation: (token: string) => ["invitation", token] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.list,
    queryFn: ({ signal }) => workspacesApi.list(signal),
    select: (d) => d.items,
    staleTime: 60_000,
  });
}

/** Troca o workspace da sessão: todo o cache é descartado (documentos, conversas, análises são de outro workspace). */
export function useSwitchWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => workspacesApi.switch(workspaceId),
    onSuccess: (user: UserMe) => {
      qc.clear();
      qc.setQueryData(authKeys.me, user);
    },
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => workspacesApi.rename(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workspace", "current"] });
      void qc.invalidateQueries({ queryKey: workspaceKeys.list });
      void qc.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => workspacesApi.updateMemberRole(userId, role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workspace", "members"] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => workspacesApi.removeMember(userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workspace", "members"] }),
  });
}

export function useInvitations(enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.invitations,
    queryFn: ({ signal }) => workspacesApi.invitations(signal),
    select: (d) => d.items,
    enabled,
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: Role }) => workspacesApi.createInvitation(email, role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workspaceKeys.invitations }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workspacesApi.revokeInvitation(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workspaceKeys.invitations }),
  });
}

export function useInvitation(token: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.invitation(token ?? ""),
    queryFn: ({ signal }) => workspacesApi.invitation(token ?? "", signal),
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => workspacesApi.acceptInvitation(token),
    onSuccess: (user: UserMe) => {
      qc.clear();
      qc.setQueryData(authKeys.me, user);
    },
  });
}
