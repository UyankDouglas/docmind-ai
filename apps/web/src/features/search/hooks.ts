import { useQuery } from "@tanstack/react-query";
import { searchApi, type SearchInput } from "./api";

export function useSemanticSearch(input: SearchInput | null) {
  return useQuery({
    queryKey: ["search", input],
    queryFn: ({ signal }) => searchApi.search(input!, signal),
    enabled: !!input && input.query.trim().length > 0,
    staleTime: 60_000,
  });
}
