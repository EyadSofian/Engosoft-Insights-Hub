import { useQuery } from "@tanstack/react-query";
import { useFilters, buildQuery } from "@/lib/filter-store";

export function useApi<T>(path: string) {
  const filters = useFilters();
  const qs = buildQuery(filters);
  return useQuery<T>({
    queryKey: [path, filters],
    queryFn: async () => {
      const res = await fetch(`${path}${qs}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}
