import { useFilters } from "@/lib/filter-store";

/**
 * The selected reporting window, as one readable string.
 *
 * A read of the existing filter store — it holds no state of its own and sets
 * nothing, so a page can name its window in the header without every route
 * repeating the same two-field format.
 */
export function useReportingPeriod(): string | undefined {
  const filters = useFilters();
  return filters.from && filters.to ? `${filters.from} → ${filters.to}` : undefined;
}
