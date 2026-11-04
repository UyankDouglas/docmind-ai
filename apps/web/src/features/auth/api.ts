import { http } from "@/services/api";
import type { UserMe } from "@/types/api";

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export const authApi = {
  me: (signal?: AbortSignal) => http.get<UserMe>("/auth/me", undefined, signal),
  login: (input: LoginInput) => http.post<UserMe>("/auth/login", input),
  register: (input: RegisterInput) => http.post<UserMe>("/auth/register", input),
  logout: () => http.post<void>("/auth/logout"),
};
