export type CourseLeadAlertKind = "lead_drop" | "cpl_spike" | "spend_without_leads";
export type CourseLeadSignalStatus = "critical" | "warning" | "stable";

export interface CourseDailyFact {
  date: string;
  course: string;
  leads: number;
  spend: number;
}

export interface CourseLeadTrendPoint {
  date: string;
  leads: number;
  spend: number;
  cpl: number | null;
}

export interface CourseLeadSignal {
  key: string;
  course: string;
  status: CourseLeadSignalStatus;
  issues: CourseLeadAlertKind[];
  current: CourseLeadTrendPoint;
  baseline: {
    leadsPerDay: number;
    spendPerDay: number;
    cpl: number | null;
    totalLeads: number;
  };
  leadDeltaPct: number | null;
  cplDeltaPct: number | null;
  trend: CourseLeadTrendPoint[];
}

export interface CourseLeadAlertReport {
  generatedAt: string;
  anchorDate: string;
  baselineWeeks: number;
  baselineDates: string[];
  freshness: {
    ok: boolean;
    ageDays: number;
    message: string;
  };
  summary: {
    courseCount: number;
    alertCount: number;
    criticalCount: number;
    warningCount: number;
    leadDropCount: number;
    cplSpikeCount: number;
    spendWithoutLeadsCount: number;
  };
  rows: CourseLeadSignal[];
}

const DAY_MS = 86_400_000;

function shiftDay(day: string, delta: number): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + delta * DAY_MS).toISOString().slice(0, 10);
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function pctChange(current: number, baseline: number): number | null {
  return baseline > 0 && Number.isFinite(current / baseline)
    ? ((current - baseline) / baseline) * 100
    : null;
}

function courseKey(course: string): string {
  return course.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function severityRank(status: CourseLeadSignalStatus): number {
  return status === "critical" ? 2 : status === "warning" ? 1 : 0;
}

/**
 * Detects operational course changes against the same weekday in prior weeks.
 * Comparing Thursday with earlier Thursdays prevents the weekend pattern from
 * being misreported as a sudden performance failure.
 */
export function analyzeCourseLeadFacts(
  facts: CourseDailyFact[],
  options: {
    anchorDate: string;
    generatedAt?: string;
    baselineWeeks?: number;
    trendDays?: number;
    freshnessAgeDays?: number;
    freshnessMessage?: string;
    suppressAlerts?: boolean;
  },
): CourseLeadAlertReport {
  const baselineWeeks = Math.max(4, Math.min(12, options.baselineWeeks ?? 8));
  const trendDays = Math.max(7, Math.min(60, options.trendDays ?? 28));
  const baselineDates = Array.from({ length: baselineWeeks }, (_, index) =>
    shiftDay(options.anchorDate, -(index + 1) * 7),
  );
  const trendDates = Array.from({ length: trendDays }, (_, index) =>
    shiftDay(options.anchorDate, index - trendDays + 1),
  );
  const relevantDates = new Set([options.anchorDate, ...baselineDates, ...trendDates]);
  const byCourse = new Map<
    string,
    { name: string; days: Map<string, { leads: number; spend: number }> }
  >();

  for (const fact of facts) {
    const name = fact.course.trim();
    const key = courseKey(name);
    if (!name || !key || !relevantDates.has(fact.date)) continue;
    let course = byCourse.get(key);
    if (!course) {
      course = { name, days: new Map() };
      byCourse.set(key, course);
    }
    const day = course.days.get(fact.date) ?? { leads: 0, spend: 0 };
    day.leads += Math.max(0, safeNumber(fact.leads));
    day.spend += Math.max(0, safeNumber(fact.spend));
    course.days.set(fact.date, day);
  }

  const rows: CourseLeadSignal[] = [];
  for (const [key, course] of byCourse) {
    const currentRaw = course.days.get(options.anchorDate) ?? { leads: 0, spend: 0 };
    const baselineRaw = baselineDates.map(
      (date) => course.days.get(date) ?? { leads: 0, spend: 0 },
    );
    const baselineLeads = baselineRaw.reduce((sum, day) => sum + day.leads, 0);
    const baselineSpend = baselineRaw.reduce((sum, day) => sum + day.spend, 0);
    const baselineLeadsPerDay = baselineLeads / baselineWeeks;
    const baselineSpendPerDay = baselineSpend / baselineWeeks;
    const currentCpl = currentRaw.leads > 0 ? currentRaw.spend / currentRaw.leads : null;
    const baselineCpl = baselineLeads > 0 ? baselineSpend / baselineLeads : null;
    const leadDeltaPct = pctChange(currentRaw.leads, baselineLeadsPerDay);
    const cplDeltaPct =
      currentCpl !== null && baselineCpl !== null ? pctChange(currentCpl, baselineCpl) : null;
    const issues: CourseLeadAlertKind[] = [];

    if (!options.suppressAlerts) {
      if (currentRaw.leads === 0 && currentRaw.spend >= 20 && baselineLeadsPerDay >= 1) {
        issues.push("spend_without_leads");
      }
      if (
        baselineLeadsPerDay >= 3 &&
        currentRaw.leads <= baselineLeadsPerDay * 0.6 &&
        baselineLeadsPerDay - currentRaw.leads >= 2
      ) {
        issues.push("lead_drop");
      }
      if (
        currentCpl !== null &&
        baselineCpl !== null &&
        baselineLeads >= 8 &&
        currentRaw.spend >= 20 &&
        currentCpl >= baselineCpl * 1.3 &&
        currentCpl - baselineCpl >= 2
      ) {
        issues.push("cpl_spike");
      }
    }

    const critical =
      issues.includes("spend_without_leads") ||
      (issues.includes("lead_drop") && (leadDeltaPct ?? 0) <= -60) ||
      (issues.includes("cpl_spike") && (cplDeltaPct ?? 0) >= 60);
    const status: CourseLeadSignalStatus = critical
      ? "critical"
      : issues.length
        ? "warning"
        : "stable";
    const trend = trendDates.map((date) => {
      const day = course.days.get(date) ?? { leads: 0, spend: 0 };
      return {
        date,
        leads: day.leads,
        spend: day.spend,
        cpl: day.leads > 0 ? day.spend / day.leads : null,
      };
    });

    // Courses that had no activity in the current, baseline or trend window do
    // not belong in an operational monitor.
    if (
      currentRaw.leads === 0 &&
      currentRaw.spend === 0 &&
      baselineLeads === 0 &&
      baselineSpend === 0 &&
      trend.every((day) => day.leads === 0 && day.spend === 0)
    ) {
      continue;
    }

    rows.push({
      key,
      course: course.name,
      status,
      issues,
      current: {
        date: options.anchorDate,
        leads: currentRaw.leads,
        spend: currentRaw.spend,
        cpl: currentCpl,
      },
      baseline: {
        leadsPerDay: baselineLeadsPerDay,
        spendPerDay: baselineSpendPerDay,
        cpl: baselineCpl,
        totalLeads: baselineLeads,
      },
      leadDeltaPct,
      cplDeltaPct,
      trend,
    });
  }

  rows.sort(
    (a, b) =>
      severityRank(b.status) - severityRank(a.status) ||
      (a.leadDeltaPct ?? 0) - (b.leadDeltaPct ?? 0) ||
      b.current.spend - a.current.spend ||
      a.course.localeCompare(b.course),
  );

  const freshnessAgeDays = Math.max(0, options.freshnessAgeDays ?? 0);
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    anchorDate: options.anchorDate,
    baselineWeeks,
    baselineDates,
    freshness: {
      ok: !options.suppressAlerts,
      ageDays: freshnessAgeDays,
      message: options.freshnessMessage ?? "",
    },
    summary: {
      courseCount: rows.length,
      alertCount: rows.filter((row) => row.status !== "stable").length,
      criticalCount: rows.filter((row) => row.status === "critical").length,
      warningCount: rows.filter((row) => row.status === "warning").length,
      leadDropCount: rows.filter((row) => row.issues.includes("lead_drop")).length,
      cplSpikeCount: rows.filter((row) => row.issues.includes("cpl_spike")).length,
      spendWithoutLeadsCount: rows.filter((row) => row.issues.includes("spend_without_leads"))
        .length,
    },
    rows,
  };
}
