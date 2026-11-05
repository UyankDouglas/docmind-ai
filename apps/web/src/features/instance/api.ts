import { http } from "@/services/api";
import type { DemoSamplesResult, InstanceInfo } from "@/types/api";

export const instanceApi = {
  get: (signal?: AbortSignal) => http.get<InstanceInfo>("/instance", undefined, signal),
  loadSamples: () => http.post<DemoSamplesResult>("/demo/samples"),
};
