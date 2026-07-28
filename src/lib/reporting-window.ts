/**
 * Approved validation window for the current management report.
 *
 * Upstream sources can already contain rows after the signed-off cutoff. Those
 * rows remain available through a manually selected range, but an unfiltered
 * dashboard must reconcile to the approved 1 Jan → 27 Jul 2026 workbook.
 */
export const REPORTING_WINDOW_START = "2026-01-01";
export const REPORTING_WINDOW_END = "2026-07-27";

export function approvedReportingEnd(latest?: string): string {
  if (!latest) return REPORTING_WINDOW_END;
  return latest < REPORTING_WINDOW_END ? latest : REPORTING_WINDOW_END;
}
