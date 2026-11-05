import { http } from "@/services/api";
import type { UserSessionInfo } from "@/types/api";

export const accountApi = {
  forgotPassword: (email: string) => http.post<void>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => http.post<void>("/auth/reset-password", { token, password }),
  changePassword: (current_password: string, new_password: string) =>
    http.post<void>("/auth/change-password", { current_password, new_password }),
  sessions: (signal?: AbortSignal) => http.get<{ items: UserSessionInfo[] }>("/auth/sessions", undefined, signal),
  revokeSession: (id: string) => http.delete(`/auth/sessions/${id}`),
  revokeOtherSessions: () => http.delete("/auth/sessions"),
};
