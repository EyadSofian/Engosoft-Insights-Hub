/** Default start of the 2026 management reporting window. */
export const REPORTING_WINDOW_START = "2026-01-01";

/** One shared opening preset for the client controls and server fallback. */
export const DEFAULT_DATE_PRESET = "month" as const;

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

/** The default dashboard period: month-to-date at the freshest approved date. */
export function defaultReportingMonth(latest?: string): { from: string; to: string } {
  const to = approvedReportingEnd(latest);
  return { from: `${to.slice(0, 7)}-01`, to };
}
