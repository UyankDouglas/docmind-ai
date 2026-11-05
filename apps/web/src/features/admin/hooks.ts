import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsKeys } from "@/features/settings/hooks";
import { adminApi, type AuditFilters } from "./api";

export const adminKeys = {
  usage: (days: number) => ["admin", "usage", days] as const,
  audit: (filters: AuditFilters) => ["admin", "audit", filters] as const,
};

export function useAdminUsage(days: number) {
  return useQuery({
    queryKey: adminKeys.usage(days),
    queryFn: ({ signal }) => adminApi.usage(days, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAudit(filters: AuditFilters) {
  return useQuery({
    queryKey: adminKeys.audit(filters),
    queryFn: ({ signal }) => adminApi.audit(filters, signal),
    placeholderData: keepPreviousData,
  });
}

export function useRunRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.runRetention(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.workspaceSettings });
      void qc.invalidateQueries({ queryKey: ["usage"] });
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}
