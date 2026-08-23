export const WEEKEND_WEEKDAYS = [4, 5, 6] as const;

export type WeekendDayKey = "thursday" | "friday" | "saturday";
export type WeekendDecision = "full" | "reallocate" | "reduce" | "insufficient";

export interface WeekendOutcomeMetrics {
  spend: number;
  leads: number;
  won: number;
  lost: number;
  cpl: number | null;
  salesRate: number | null;
  lostRate: number | null;
}

const DAY_KEY: Record<(typeof WEEKEND_WEEKDAYS)[number], WeekendDayKey> = {
  4: "thursday",
  5: "friday",
  6: "saturday",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return parsed;
}

export function shiftIsoDate(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/** Eight complete Sunday-to-Saturday weeks, ending on the latest completed Saturday. */
export function completedWeekendWindow(
  anchor: string,
  weeks = 8,
): {
  from: string;
  to: string;
  weeks: number;
  weekendDays: number;
  comparisonDays: number;
} {
  const date = parseIsoDate(anchor);
  const daysSinceSaturday = (date.getUTCDay() - 6 + 7) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceSaturday);
  const to = isoDate(date);
  const from = shiftIsoDate(to, -(weeks * 7 - 1));
  return {
    from,
    to,
    weeks,
    weekendDays: weeks * 3,
    comparisonDays: weeks * 4,
  };
}

export function utcWeekday(value: string): number {
  return parseIsoDate(value).getUTCDay();
}

export function weekendDayKey(value: string): WeekendDayKey | null {
  const day = utcWeekday(value);
  return day === 4 || day === 5 || day === 6 ? DAY_KEY[day] : null;
}

export function isWeekendDate(value: string): boolean {
  return weekendDayKey(value) !== null;
}

export function weekStart(value: string): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return isoDate(date);
}

export function ratioDelta(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null || baseline <= 0) return null;
  return ((current - baseline) / baseline) * 100;
}

export function pointDelta(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return current - baseline;
}

/**
 * An explainable budget rule, not an opaque score. Weekend performance must
 * earn full budget by matching its own platform's Sunday-Wednesday baseline.
 */
export function weekendBudgetDecision(
  weekend: WeekendOutcomeMetrics,
  comparison: WeekendOutcomeMetrics,
  options: { lostAvailable: boolean; hasSpendData: boolean },
): WeekendDecision {
  if (
    !options.lostAvailable ||
    !options.hasSpendData ||
    weekend.spend <= 0 ||
    comparison.spend <= 0 ||
    weekend.leads < 30 ||
    comparison.leads < 30 ||
    weekend.cpl === null ||
    comparison.cpl === null ||
    weekend.salesRate === null ||
    comparison.salesRate === null ||
    weekend.lostRate === null ||
    comparison.lostRate === null
  ) {
    return "insufficient";
  }

  const cplChange = ratioDelta(weekend.cpl, comparison.cpl) ?? 0;
  const salesChange = pointDelta(weekend.salesRate, comparison.salesRate) ?? 0;
  const lostChange = pointDelta(weekend.lostRate, comparison.lostRate) ?? 0;
  // A weak weekday baseline cannot earn full weekend budget by itself. These
  // absolute guards keep "equally poor" from being presented as healthy.
  const clearsQualityFloor = weekend.salesRate >= 2 && weekend.lostRate <= 40;

  if (cplChange <= 10 && salesChange >= -2 && lostChange <= 3 && clearsQualityFloor) return "full";
  if (
    cplChange > 25 ||
    salesChange < -4 ||
    lostChange > 6 ||
    weekend.salesRate < 0.5 ||
    weekend.lostRate > 55
  )
    return "reduce";
  return "reallocate";
}
