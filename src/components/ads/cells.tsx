import type { ReactNode } from "react";
import type { Maybe } from "@/lib/types";

const EM = "—";

/** A metric the source did not report. Grey, never red — a gap is not a failure. */
export function maybeCell(value: Maybe, fmt: (v: number) => string): ReactNode {
  return value === null || !isFinite(value) ? (
    <span className="text-text-subtle">{EM}</span>
  ) : (
    fmt(value)
  );
}

/**
 * A ratio, guarded on the quantity it is measured against — spend for CPL, CPA,
 * ROAS and ACOS; impressions for CTR.
 *
 * With no spend there is no advertising cost ratio, so these render as a dash.
 * ROAS already behaved this way because dividing by zero returns null; ACOS and
 * CPA would otherwise print a confident `0%` / `$0` on a row that never spent a
 * cent — the exact "looks like a real result" failure the dash exists to
 * prevent. This changes nothing that is computed, only what is shown.
 */
export function ratioCell(
  value: Maybe,
  basis: number,
  fmt: (v: number) => string,
  title?: string,
): ReactNode {
  if (basis <= 0)
    return (
      <span className="text-text-subtle" title={title}>
        {EM}
      </span>
    );
  return maybeCell(value, fmt);
}

/** Sort keys must be numbers; nulls sink to the bottom in either direction. */
export function sortMaybe(value: Maybe): number {
  return value === null || !isFinite(value) ? -Infinity : value;
}

/** The same guard as `ratioCell`, for sorting. */
export function sortRatio(value: Maybe, basis: number): number {
  return basis <= 0 ? -Infinity : sortMaybe(value);
}

export function csvMaybe(value: Maybe, digits = 2): string {
  return value === null || !isFinite(value) ? "" : value.toFixed(digits);
}

/** The same guard as `ratioCell`, so the export and the screen never disagree. */
export function csvRatio(value: Maybe, basis: number, digits = 2): string {
  return basis <= 0 ? "" : csvMaybe(value, digits);
}
