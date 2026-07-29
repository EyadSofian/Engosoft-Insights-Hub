/** Default start of the 2026 management reporting window. */
export const REPORTING_WINDOW_START = "2026-01-01";

/** Presets follow the newest date actually present in the source data. */
export function approvedReportingEnd(latest?: string): string {
  if (latest) return latest;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
