import { http } from "@/services/api";
import type { Collection } from "@/types/api";

export interface CollectionInput {
  name: string;
  description?: string | null;
  color?: string | null;
}

export const collectionsApi = {
  list: (signal?: AbortSignal) => http.get<{ items: Collection[] }>("/collections", undefined, signal),
  get: (id: string, signal?: AbortSignal) => http.get<Collection>(`/collections/${id}`, undefined, signal),
  create: (input: CollectionInput) => http.post<Collection>("/collections", input),
  update: (id: string, input: Partial<CollectionInput>) => http.patch<Collection>(`/collections/${id}`, input),
  remove: (id: string) => http.delete(`/collections/${id}`),
};
