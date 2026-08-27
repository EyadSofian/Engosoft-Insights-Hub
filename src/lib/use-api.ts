import { useQuery } from "@tanstack/react-query";
import { useFilters } from "@/lib/filter-store";

/**
 * Fetches an endpoint with the global filters appended. `path` may already carry
 * its own query string (e.g. `?grain=adset`); those params are merged rather
 * than concatenated, which would otherwise produce a second `?` and be dropped.
 */
export function useApi<T>(path: string, options: { enabled?: boolean } = {}) {
  const filters = useFilters();

  const [base, own = ""] = path.split("?");
  const params = new URLSearchParams(own);
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
  const qs = params.toString();
  const url = qs ? `${base}?${qs}` : base;

  return useQuery<T>({
    queryKey: [base, own, filters],
    // Detail dialogs pass `enabled: false` while closed. Besides avoiding work
    // the reader never asked for, this matters for expensive joins such as
    // Odoo leads + Yeastar calls: mounting a hidden dialog must not double the
    // employee page's upstream traffic.
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) {
        // Routes that fail on purpose (a missing integration, an upstream that
        // is down) send `{ error }`. Surfacing it beats "Request failed: 503",
        // which tells the reader nothing about what to fix.
        const detail = await res
          .clone()
          .json()
          .then((body: { error?: string }) => body?.error)
          .catch(() => undefined);
        throw new Error(detail || `Request failed: ${res.status}`);
      }
      return res.json();
    },
    staleTime: 30_000,
  });
}
