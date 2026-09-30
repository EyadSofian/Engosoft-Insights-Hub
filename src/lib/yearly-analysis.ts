import { accountingReportingDate } from "./accounting-policy";
import { isExcludedFromSalesRevenue } from "./sales-revenue-policy";
import { UNATTRIBUTED_COURSE } from "./course-taxonomy";
import type { AccountingRow, AdRow, CrmLeadRow, LostRow, YoyPoint, YoyResult } from "./types";
import type { HistoricalCrmDay } from "./crm-odoo.server";

export interface AnnualNumbers {
  spend: number;
  revenue: number;
  leads: number;
  won: number;
  lost: number;
  wonRate: number | null;
  lostRate: number | null;
}

export interface AnnualCourse extends AnnualNumbers {
  name: string;
}

export interface AnnualMonth {
  month: number;
  current: AnnualNumbers;
  previous: AnnualNumbers;
  /** The chosen month is truncated on both sides to the same day when it is still in progress. */
  throughDay: number;
}

export interface AnnualComparison {
  year: number;
  previousYear: number;
  throughMonth: number;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  partialMonth: boolean;
  current: AnnualNumbers;
  previous: AnnualNumbers;
  months: AnnualMonth[];
  courses: { name: string; current: AnnualCourse; previous: AnnualCourse }[];
  coverage: {
    current: {
      ads: number;
      accounting: number;
      crm: number;
      lost: number;
      historical: number;
      inventory: number;
    };
    previous: {
      ads: number;
      accounting: number;
      crm: number;
      lost: number;
      historical: number;
      inventory: number;
    };
    comparable: { spend: boolean; revenue: boolean; crm: boolean };
    historicalReadyYears: number[];
  };
}

export interface AnnualSource {
  ads: AdRow[];
  accounting: AccountingRow[];
  crm: CrmLeadRow[];
  lost: LostRow[];
  historicalCrm?: HistoricalCrmDay[];
  historicalReadyYears?: number[];
}

const isoDay = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const ratio = (part: number, total: number) => (total > 0 ? (part / total) * 100 : null);

function blank(): AnnualNumbers {
  return { spend: 0, revenue: 0, leads: 0, won: 0, lost: 0, wonRate: null, lostRate: null };
}

function finish<T extends AnnualNumbers>(numbers: T): T {
  return {
    ...numbers,
    wonRate: ratio(numbers.won, numbers.leads),
    lostRate: ratio(numbers.lost, numbers.leads),
  };
}

function bucket(map: Map<string, AnnualCourse>, name: string): AnnualCourse {
  const raw = name.trim();
  const key = raw && raw !== "." && raw !== "-" ? raw : UNATTRIBUTED_COURSE;
  let value = map.get(key);
  if (!value) {
    value = { ...blank(), name: key };
    map.set(key, value);
  }
  return value;
}

function collect(
  source: AnnualSource,
  from: string,
  to: string,
  courseOfAd: (row: AdRow) => string,
) {
  const totals = blank();
  const months = Array.from({ length: 12 }, () => blank());
  const courses = new Map<string, AnnualCourse>();
  const coverage = { ads: 0, accounting: 0, crm: 0, lost: 0, historical: 0, inventory: 0 };
  const inWindow = (date: string) => !!date && date >= from && date <= to;
  const monthly = (date: string) => months[Number(date.slice(5, 7)) - 1];
  const useHistorical = source.historicalReadyYears?.includes(Number(from.slice(0, 4))) ?? false;

  for (const row of source.ads) {
    if (!inWindow(row.date)) continue;
    coverage.ads++;
    totals.spend += row.spend;
    monthly(row.date).spend += row.spend;
    bucket(courses, courseOfAd(row)).spend += row.spend;
  }
  for (const row of source.accounting) {
    if (isExcludedFromSalesRevenue(row)) continue;
    const date = accountingReportingDate(row, "payment");
    if (!inWindow(date)) continue;
    coverage.accounting++;
    totals.revenue += row.usdPaid;
    monthly(date).revenue += row.usdPaid;
    bucket(courses, row.course).revenue += row.usdPaid;
  }
  for (const row of useHistorical ? [] : source.crm) {
    if (!inWindow(row.createdAt)) continue;
    coverage.crm++;
    totals.leads++;
    monthly(row.createdAt).leads++;
    const course = bucket(courses, row.course);
    course.leads++;
    if (row.isWon) {
      totals.won++;
      monthly(row.createdAt).won++;
      course.won++;
    }
  }
  // Snapshot.crm and Snapshot.lost are disjoint under CRM contract 1.26.
  // Lost is attributed to lead creation month, not the month it was closed.
  for (const row of useHistorical ? [] : source.lost) {
    if (!inWindow(row.createdAt)) continue;
    coverage.lost++;
    totals.leads++;
    totals.lost++;
    monthly(row.createdAt).leads++;
    monthly(row.createdAt).lost++;
    const course = bucket(courses, row.course);
    course.leads++;
    course.lost++;
  }
  // A complete historical Odoo year replaces, rather than supplements, the
  // normal snapshot for that year. This prevents duplicate Lost records.
  for (const row of useHistorical ? (source.historicalCrm ?? []) : []) {
    if (!inWindow(row.createdAt)) continue;
    const day = monthly(row.createdAt);
    const course = bucket(courses, row.course);
    coverage.historical += row.leads;
    coverage.inventory += row.inventoryLeads;
    totals.leads += row.leads;
    totals.won += row.won;
    totals.lost += row.lost;
    day.leads += row.leads;
    day.won += row.won;
    day.lost += row.lost;
    course.leads += row.leads;
    course.won += row.won;
    course.lost += row.lost;
  }

  return {
    totals: finish(totals),
    months: months.map(finish),
    courses,
    coverage,
  };
}

/** One consistent Odoo cohort + paid-invoice + ads comparison through a selected month. */
export function buildAnnualComparison(
  source: AnnualSource,
  year: number,
  throughMonth: number,
  today: string,
  courseOfAd: (row: AdRow) => string = () => "",
): AnnualComparison {
  const month = Math.min(12, Math.max(1, Math.trunc(throughMonth)));
  const previousYear = year - 1;
  const fullDay = lastDay(year, month);
  const todayIsInSelectedMonth = today.slice(0, 7) === isoDay(year, month, 1).slice(0, 7);
  const day = todayIsInSelectedMonth ? Math.min(fullDay, Number(today.slice(8, 10))) : fullDay;
  const currentFrom = isoDay(year, 1, 1);
  const currentTo = isoDay(year, month, day);
  const previousFrom = isoDay(previousYear, 1, 1);
  const previousTo = isoDay(previousYear, month, Math.min(day, lastDay(previousYear, month)));
  const current = collect(source, currentFrom, currentTo, courseOfAd);
  const previous = collect(source, previousFrom, previousTo, courseOfAd);
  const historicalReadyYears = source.historicalReadyYears ?? [];
  const leadSourceReady = (candidateYear: number) =>
    candidateYear >= 2026 || historicalReadyYears.includes(candidateYear);
  const courseNames = new Set([...current.courses.keys(), ...previous.courses.keys()]);

  return {
    year,
    previousYear,
    throughMonth: month,
    currentFrom,
    currentTo,
    previousFrom,
    previousTo,
    partialMonth: day < fullDay,
    current: current.totals,
    previous: previous.totals,
    months: Array.from({ length: month }, (_, index) => ({
      month: index + 1,
      current: current.months[index],
      previous: previous.months[index],
      throughDay: index + 1 === month ? day : lastDay(year, index + 1),
    })),
    courses: [...courseNames]
      .map((name) => ({
        name,
        current: finish(current.courses.get(name) ?? { ...blank(), name }),
        previous: finish(previous.courses.get(name) ?? { ...blank(), name }),
      }))
      .sort((a, b) => b.current.revenue - a.current.revenue || a.name.localeCompare(b.name)),
    coverage: {
      current: current.coverage,
      previous: previous.coverage,
      historicalReadyYears,
      comparable: {
        // The historical-source floor prevents a few surviving ad/accounting
        // rows from masquerading as a complete previous year. Historical CRM
        // is a complete Odoo year pull, so it is gated by successful sync.
        spend: current.coverage.ads > 0 && previous.coverage.ads >= 100,
        revenue: current.coverage.accounting > 0 && previous.coverage.accounting >= 100,
        crm:
          leadSourceReady(year) &&
          leadSourceReady(previousYear) &&
          (year <= 2025 || current.coverage.crm >= 100) &&
          (previousYear <= 2025 || previous.coverage.crm >= 100) &&
          current.totals.leads > 0 &&
          previous.totals.leads > 0,
      },
    },
  };
}

/** Keep the existing /api/yoy fields aligned with the selected annual window. */
export function annualAsYoyResult(annual: AnnualComparison): YoyResult {
  const metricAvailability = {
    spend: annual.coverage.comparable.spend,
    revenue: annual.coverage.comparable.revenue,
    leads: annual.coverage.comparable.crm,
    won: annual.coverage.comparable.crm,
  };
  const growth = (current: number, previous: number, available: boolean) =>
    available && previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
  const point = (key: string, current: number, previous: number, available: boolean): YoyPoint => ({
    key,
    current,
    previous,
    delta: current - previous,
    growth: growth(current, previous, available),
  });
  const measures = ["spend", "revenue", "leads", "won"] as const;
  const series = (metric: (typeof measures)[number]) =>
    annual.months.map((month) =>
      point(
        `${annual.year}-${String(month.month).padStart(2, "0")}`,
        month.current[metric],
        month.previous[metric],
        metricAvailability[metric],
      ),
    );
  const available = Object.values(metricAvailability).some(Boolean);
  return {
    available,
    metricAvailability,
    currentYear: annual.year,
    previousYear: annual.previousYear,
    reason: available ? undefined : "no_prior_year",
    spend: series("spend"),
    revenue: series("revenue"),
    leads: series("leads"),
    won: series("won"),
    byCourse: annual.courses.map((course) => ({
      ...point(
        course.name,
        course.current.revenue,
        course.previous.revenue,
        metricAvailability.revenue,
      ),
      metric: "revenue",
    })),
    ytd: measures.map((metric) => ({
      metric,
      current: annual.current[metric],
      previous: annual.previous[metric],
      growth: growth(annual.current[metric], annual.previous[metric], metricAvailability[metric]),
    })),
  };
}
