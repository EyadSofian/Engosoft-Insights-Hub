/**
 * The one Lost classification every screen reuses.
 *
 * Three populations answer three different questions and are never mixed:
 *
 *   cohortLost                 leads CREATED in the window that are (now) Lost.
 *                              Marketing quality: what did this intake turn into?
 *   closedLostInPeriod         leads whose Lost/Close Date falls in the window.
 *                              Operational movement: what was closed Lost this period?
 *     createdAndLostInPeriod        …of which the lead was also created in the window
 *     olderCohortClosedLostInPeriod …of which the lead was created before the window
 *     undatedCohortClosedLostInPeriod …of which the creation date is missing or
 *                                      after the window (a data defect, kept visible)
 *
 * `closedLostInPeriod` always equals the sum of its three parts, so a split can
 * never silently lose a record. The generic `lost` field elsewhere is the cohort
 * population; nothing that ranks closures may read it.
 *
 * Pure so the rules are tested once. The Lost dataset's `closeDate` is the
 * canonical Lost movement date written by the Odoo 1.26 contract.
 */

export interface LostClassifiable {
  id: string;
  /** Odoo creation date, `YYYY-MM-DD` (Cairo). */
  createdAt: string;
  /** Canonical Lost movement date, `YYYY-MM-DD` (Cairo). */
  closeDate: string;
}

export interface ReportingWindow {
  from?: string;
  to?: string;
}

export type ClosedLostSplit = "created_in_period" | "older_cohort" | "undated_cohort";

export interface LostRowClassification {
  cohortLost: boolean;
  closedLostInPeriod: boolean;
  /** Set only when `closedLostInPeriod` is true. */
  closedSplit: ClosedLostSplit | null;
}

const day = (value: string): string => String(value || "").slice(0, 10);

/**
 * Same rule as the rest of the dashboard: with no window everything passes, and
 * once a window exists an undated row is excluded rather than leaking all-time
 * history into the period.
 */
export function dayInWindow(value: string, window: ReportingWindow): boolean {
  if (!window.from && !window.to) return true;
  const date = day(value);
  if (!date) return false;
  if (window.from && date < window.from) return false;
  if (window.to && date > window.to) return false;
  return true;
}

export function classifyLostRow(
  row: LostClassifiable,
  window: ReportingWindow,
): LostRowClassification {
  const cohortLost = dayInWindow(row.createdAt, window);
  const closedLostInPeriod = dayInWindow(row.closeDate, window);
  if (!closedLostInPeriod) return { cohortLost, closedLostInPeriod, closedSplit: null };
  const created = day(row.createdAt);
  const closedSplit: ClosedLostSplit = cohortLost
    ? "created_in_period"
    : created && window.from && created < window.from
      ? "older_cohort"
      : "undated_cohort";
  return { cohortLost, closedLostInPeriod, closedSplit };
}

export interface LostPopulations<T> {
  cohortLost: T[];
  closedLostInPeriod: T[];
  createdAndLostInPeriod: T[];
  olderCohortClosedLostInPeriod: T[];
  undatedCohortClosedLostInPeriod: T[];
}

export interface LostPopulationCounts {
  cohortLost: number;
  closedLostInPeriod: number;
  createdAndLostInPeriod: number;
  olderCohortClosedLostInPeriod: number;
  undatedCohortClosedLostInPeriod: number;
}

function dedupe<T extends LostClassifiable>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const key = row.id || `row:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Splits already-filtered Lost rows into the canonical populations.
 *
 * `cohortRows` and `closedRows` may come from two differently dated reads of the
 * same dataset (creation-date and close-date filtering with every other
 * dimension applied identically), or both may be the whole unfiltered Lost
 * population; the date tests are repeated here either way, so the result is the
 * same.
 */
export function lostPopulations<T extends LostClassifiable>(input: {
  cohortRows: readonly T[];
  closedRows: readonly T[];
  window: ReportingWindow;
}): LostPopulations<T> {
  const cohortLost = dedupe(input.cohortRows).filter((row) =>
    dayInWindow(row.createdAt, input.window),
  );
  const closedLostInPeriod = dedupe(input.closedRows).filter((row) =>
    dayInWindow(row.closeDate, input.window),
  );
  const populations: LostPopulations<T> = {
    cohortLost,
    closedLostInPeriod,
    createdAndLostInPeriod: [],
    olderCohortClosedLostInPeriod: [],
    undatedCohortClosedLostInPeriod: [],
  };
  for (const row of closedLostInPeriod) {
    const { closedSplit } = classifyLostRow(row, input.window);
    if (closedSplit === "created_in_period") populations.createdAndLostInPeriod.push(row);
    else if (closedSplit === "older_cohort") populations.olderCohortClosedLostInPeriod.push(row);
    else populations.undatedCohortClosedLostInPeriod.push(row);
  }
  return populations;
}

export function lostPopulationCounts<T>(populations: LostPopulations<T>): LostPopulationCounts {
  return {
    cohortLost: populations.cohortLost.length,
    closedLostInPeriod: populations.closedLostInPeriod.length,
    createdAndLostInPeriod: populations.createdAndLostInPeriod.length,
    olderCohortClosedLostInPeriod: populations.olderCohortClosedLostInPeriod.length,
    undatedCohortClosedLostInPeriod: populations.undatedCohortClosedLostInPeriod.length,
  };
}

/**
 * "Highest Closed Lost": ranked by the closure movement, never by the cohort
 * `lost` field. Ties fall back to the older-cohort share (closures of inherited
 * leads), then name, so the order is stable.
 */
export function rankHighestClosedLost<
  T extends { name: string; closedLostInPeriod: number; olderCohortClosedLostInPeriod: number },
>(rows: readonly T[], limit = 10): T[] {
  return [...rows]
    .filter((row) => row.closedLostInPeriod > 0)
    .sort(
      (a, b) =>
        b.closedLostInPeriod - a.closedLostInPeriod ||
        b.olderCohortClosedLostInPeriod - a.olderCohortClosedLostInPeriod ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
