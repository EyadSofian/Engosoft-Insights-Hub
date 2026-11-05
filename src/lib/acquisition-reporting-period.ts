export interface AcquisitionDateFilters {
  from?: string;
  to?: string;
  range?: "all";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Keep an explicit All time selection across API boundaries. */
export function acquisitionDateFilters(params: URLSearchParams): AcquisitionDateFilters {
  return {
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    range: params.get("range") === "all" ? "all" : undefined,
  };
}

export function acquisitionReportingPeriod(
  filters: AcquisitionDateFilters,
  today: string,
  earliest?: string,
): { from: string; to: string } {
  if (filters.range === "all") {
    return {
      from: earliest && DAY.test(earliest) && earliest <= today ? earliest : today,
      to: today,
    };
  }
  const end = filters.to && DAY.test(filters.to) ? filters.to : today;
  const start = filters.from && DAY.test(filters.from) ? filters.from : `${end.slice(0, 7)}-01`;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}
