import { useQuery } from "@tanstack/react-query";
import { useFilters } from "@/lib/filter-store";

/**
 * Fetches an endpoint with the global filters appended. `path` may already carry
 * its own query string (e.g. `?grain=adset`); those params are merged rather
 * than concatenated, which would otherwise produce a second `?` and be dropped.
 */
export function useApi<T>(path: string) {
  const filters = useFilters();

  const [base, own = ""] = path.split("?");
  const params = new URLSearchParams(own);
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
  const qs = params.toString();
  const url = qs ? `${base}?${qs}` : base;

  return useQuery<T>({
    queryKey: [base, own, filters],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}
