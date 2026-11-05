import { apiFetch, http } from "@/services/api";
import type { AdminUsage, AuditEntry, Paginated, RetentionRunResult } from "@/types/api";

export interface AuditFilters {
  action?: string;
  user_id?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

export type AuditExportFormat = "csv" | "json";

export const adminApi = {
  usage: (days: number, signal?: AbortSignal) => http.get<AdminUsage>("/admin/usage", { days }, signal),
  audit: (filters: AuditFilters, signal?: AbortSignal) => http.get<Paginated<AuditEntry>>("/audit", { ...filters }, signal),
  auditExportRaw: (format: AuditExportFormat, filters: Omit<AuditFilters, "page" | "page_size">) =>
    apiFetch("/audit/export", { method: "GET", query: { format, ...filters } }),
  runRetention: () => http.post<RetentionRunResult>("/workspaces/current/retention/run"),
};
