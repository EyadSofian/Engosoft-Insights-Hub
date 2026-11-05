import { useFilters } from "@/lib/filter-store";
import { useI18n } from "@/lib/i18n";

/**
 * The selected reporting window, as one readable string.
 *
 * A read of the existing filter store — it holds no state of its own and sets
 * nothing, so a page can name its window in the header without every route
 * repeating the same two-field format.
 */
export function useReportingPeriod(): string | undefined {
  const filters = useFilters();
  const { lang } = useI18n();
  if (filters.range === "all") return lang === "ar" ? "كل الفترات" : "All time";
  return filters.from && filters.to ? `${filters.from} → ${filters.to}` : undefined;
}
