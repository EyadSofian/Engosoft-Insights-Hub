import { BUSINESS_TIME_ZONE, eventsCte, getPool } from "./acquisition-attribution.server";
import {
  acquisitionReportingPeriod,
  type AcquisitionDateFilters,
} from "./acquisition-reporting-period";

let cached: { until: number; promise: Promise<string | undefined> } | undefined;

/** Bound All time to available source history, not an invented start year. */
async function historicalStart(): Promise<string | undefined> {
  if (cached && cached.until > Date.now()) return cached.promise;
  const promise = (async () => {
    const { cte, dashboardRows } = await eventsCte();
    const dates = await Promise.all([
      cte
        ? getPool().query<{ day: string | null }>(
            `${cte} SELECT to_char(min(occurred_at) AT TIME ZONE '${BUSINESS_TIME_ZONE}', 'YYYY-MM-DD') AS day FROM acquisition_events`,
          )
        : null,
      dashboardRows
        ? getPool().query<{ day: string | null }>(
            "SELECT min(record_date)::text AS day FROM dashboard_rows",
          )
        : null,
    ]);
    return dates
      .map((result) => result?.rows[0]?.day)
      .filter((day): day is string => !!day)
      .sort()[0];
  })();
  cached = { until: Date.now() + 60_000, promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = undefined;
  });
  return promise;
}

export async function resolveAcquisitionReportingPeriod(filters: AcquisitionDateFilters) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return acquisitionReportingPeriod(
    filters,
    today,
    filters.range === "all" ? await historicalStart() : undefined,
  );
}
