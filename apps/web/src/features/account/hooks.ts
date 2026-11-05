import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountApi } from "./api";

export const accountKeys = {
  sessions: ["auth", "sessions"] as const,
};

export function useForgotPassword() {
  return useMutation({ mutationFn: (email: string) => accountApi.forgotPassword(email) });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) => accountApi.resetPassword(token, password),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => accountApi.changePassword(current, next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: accountKeys.sessions,
    queryFn: ({ signal }) => accountApi.sessions(signal),
    select: (d) => d.items,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountApi.revokeSession(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => accountApi.revokeOtherSessions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}
