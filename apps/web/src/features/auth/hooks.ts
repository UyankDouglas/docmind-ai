import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@/services/api";
import type { UserMe } from "@/types/api";
import { authApi, type LoginInput, type RegisterInput } from "./api";

export const authKeys = {
  me: ["auth", "me"] as const,
};

export function useMe() {
  return useQuery<UserMe | null>({
    queryKey: authKeys.me,
    queryFn: async ({ signal }) => {
      try {
        return await authApi.me(signal);
      } catch (e) {
        if (isApiError(e) && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: (user) => {
      qc.setQueryData(authKeys.me, user);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => authApi.register(input),
    onSuccess: (user) => {
      qc.setQueryData(authKeys.me, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      qc.setQueryData(authKeys.me, null);
      qc.clear();
    },
  });
}
