import { matchMediaPlanCourse, type MonthlyMediaPlan } from "./media-plan";
import { attributedAdCourse, authoritativeLostLeads, type FilteredData } from "./metrics.server";
import { normalizeName } from "./sheet-cache.server";

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const key = (value: string): string => normalizeName(value || "");
const dateOnly = (value: string): string => value?.slice(0, 10) || "";
const daysBetween = (from: string, to: string): number | null => {
  const start = Date.parse(`${dateOnly(from)}T00:00:00Z`);
  const end = Date.parse(`${dateOnly(to)}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.round((end - start) / 86_400_000)
    : null;
};

type Lead = {
  id: string;
  course: string;
  owner: string;
  campaign: string;
  campaignKey: string;
  createdAt: string;
  closedAt: string;
  closeDays: number | null;
  status: "won" | "lost" | "open";
  odooUrl: string;
};

export interface LeadIntelligenceResponse {
  filters: { courses: string[]; owners: string[]; course: string; owner: string };
  period: { from: string; to: string };
  totals: {
    leads: number;
    won: number;
    lost: number;
    open: number;
    spend: number | null;
    revenue: number;
    cpl: number | null;
    cac: number | null;
    roas: number | null;
    roi: number | null;
    observedLtv: number | null;
    payingCustomers: number;
    attributedLeads: number;
  };
  courses: Array<{
    course: string;
    target: number | null;
    expectedLeads: number | null;
    targetCoverage: string;
    dailyTarget: number | null;
    leads: number;
    won: number;
    lost: number;
    open: number;
    spend: number | null;
    revenue: number;
    roas: number | null;
    achievement: number | null;
  }>;
  daily: Array<{ day: string; leads: number; target: number | null }>;
  campaigns: Array<{
    name: string;
    leads: number;
    won: number;
    lost: number;
    spend: number | null;
    revenue: number;
    cpl: number | null;
    roas: number | null;
  }>;
  lifecycle: {
    buckets: Array<{ label: string; count: number }>;
    averageDays: number | null;
    medianDays: number | null;
    sample: number;
    missingCloseDate: number;
    records: Array<
      Pick<
        Lead,
        "id" | "course" | "owner" | "status" | "createdAt" | "closedAt" | "closeDays" | "odooUrl"
      >
    >;
    total: number;
    page: number;
    pages: number;
  };
  salespeople: Array<{
    course: string;
    owner: string;
    leads: number;
    won: number;
    lost: number;
    open: number;
    settledRate: number | null;
    leadRate: number | null;
    verdict: "grow" | "review" | "insufficient";
  }>;
  notes: string[];
}

function targetForCourse(
  course: string,
  plans: Record<string, MonthlyMediaPlan>,
  from: string,
  to: string,
): { target: number | null; expected: number | null; daily: number | null; coverage: string } {
  if (!from || !to)
    return { target: null, expected: null, daily: null, coverage: "date_range_required" };
  let cursor = from.slice(0, 7);
  const endMonth = to.slice(0, 7);
  let total = 0;
  let expected = 0;
  let days = 0;
  let missing = false;
  let safety = 0;
  while (cursor <= endMonth && safety++ < 120) {
    const [year, month] = cursor.split("-").map(Number);
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthFrom = `${cursor}-01`;
    const monthTo = `${cursor}-${String(monthDays).padStart(2, "0")}`;
    const overlapFrom = from > monthFrom ? from : monthFrom;
    const overlapTo = to < monthTo ? to : monthTo;
    const overlap = daysBetween(overlapFrom, overlapTo);
    if (overlap !== null) {
      const plan = plans[cursor];
      const match = plan ? matchMediaPlanCourse(plan.courses, course) : null;
      if (match && plan?.status === "approved") {
        total += match.targetLeads;
        expected += (match.targetLeads * (overlap + 1)) / monthDays;
        days += overlap + 1;
      } else missing = true;
    }
    cursor = `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
  }
  return {
    target: days && !missing ? total : null,
    expected: days && !missing ? expected : null,
    daily: days && !missing ? expected / days : null,
    coverage: missing
      ? "no_approved_plan_for_entire_period"
      : "approved_plan_prorated_by_calendar_day",
  };
}

export function buildLeadIntelligence(
  data: FilteredData,
  plans: Record<string, MonthlyMediaPlan>,
  focusCourse = "",
  focusOwner = "",
  page = 1,
  odooBaseUrl = "",
  lifetimeData?: FilteredData,
): LeadIntelligenceResponse {
  const lost = authoritativeLostLeads(data);
  const odooOrigin = odooBaseUrl.replace(/\/$/, "");
  const planCourses = Object.values(plans).flatMap((plan) => plan.courses);
  const canonicalCourse = (value: string): string =>
    (value && matchMediaPlanCourse(planCourses, value)?.label) || value;
  const allLeads: Lead[] = [
    ...data.crm.map((row): Lead => ({
      id: row.id,
      course: canonicalCourse(row.course),
      owner: row.salesperson,
      campaign: row.campaignName,
      campaignKey: row.campaignKey,
      createdAt: row.createdAt,
      closedAt: row.isWon ? row.closedAt || row.wonDate : "",
      closeDays: row.isWon ? row.daysToClose : null,
      status: row.isWon ? "won" : "open",
      odooUrl: odooOrigin
        ? `${odooOrigin}/web#id=${encodeURIComponent(row.id)}&model=crm.lead&view_type=form`
        : "",
    })),
    ...lost.map((row): Lead => ({
      id: row.id,
      course: canonicalCourse(row.course),
      owner: row.salesperson,
      campaign: row.campaignName,
      campaignKey: row.campaignKey,
      createdAt: row.createdAt,
      closedAt: row.closeDate || row.lostDate,
      closeDays: daysBetween(row.createdAt, row.closeDate || row.lostDate),
      status: "lost",
      odooUrl: odooOrigin
        ? `${odooOrigin}/web#id=${encodeURIComponent(row.id)}&model=crm.lead&view_type=form`
        : "",
    })),
  ];
  const plannedCourses = Object.values(plans)
    .filter(
      (plan) =>
        (!data.applied.from || `${plan.month}-31` >= data.applied.from) &&
        (!data.applied.to || `${plan.month}-01` <= data.applied.to) &&
        plan.status === "approved",
    )
    .flatMap((plan) => plan.courses.map((row) => row.label));
  const courses = [
    ...new Set(
      [
        ...allLeads.map((row) => row.course),
        ...data.accounting.map((row) => canonicalCourse(row.course)),
        ...data.ads.map((row) => canonicalCourse(attributedAdCourse(row, data.snapshot).course)),
        ...plannedCourses,
      ].filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const owners = [...new Set(allLeads.map((row) => row.owner).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const matchesCourse = (course: string) => !focusCourse || key(course) === key(focusCourse);
  const matchesOwner = (owner: string) => !focusOwner || key(owner) === key(focusOwner);
  const leads = allLeads.filter((row) => matchesCourse(row.course) && matchesOwner(row.owner));
  const paid = data.accounting.filter(
    (row) => matchesCourse(canonicalCourse(row.course)) && matchesOwner(row.salesperson),
  );
  const lifetimePaid = (lifetimeData ?? data).accounting.filter(
    (row) => matchesCourse(canonicalCourse(row.course)) && matchesOwner(row.salesperson),
  );
  const ads = data.ads.filter((row) =>
    matchesCourse(canonicalCourse(attributedAdCourse(row, data.snapshot).course)),
  );
  const spend = focusOwner ? null : ads.reduce((sum, row) => sum + row.spend, 0);
  const revenue = paid.reduce((sum, row) => sum + row.usdPaid, 0);
  const won = leads.filter((row) => row.status === "won").length;
  const lostCount = leads.filter((row) => row.status === "lost").length;
  const customers = new Set(lifetimePaid.map((row) => key(row.partner)).filter(Boolean));
  const lifetimeRevenue = lifetimePaid.reduce((sum, row) => sum + row.usdPaid, 0);
  const campaignKey = (row: { campaignKey: string; campaign?: string; campaignName?: string }) =>
    row.campaignKey ||
    (row.campaign || row.campaignName ? `name:${key(row.campaign || row.campaignName || "")}` : "");
  const campaignMap = new Map<
    string,
    { name: string; leads: number; won: number; lost: number; spend: number; revenue: number }
  >();
  const campaign = (id: string, name: string) => {
    let entry = campaignMap.get(id);
    if (!entry) {
      entry = { name: name || "—", leads: 0, won: 0, lost: 0, spend: 0, revenue: 0 };
      campaignMap.set(id, entry);
    }
    return entry;
  };
  for (const row of leads) {
    const id = campaignKey(row);
    if (!id) continue;
    const entry = campaign(id, row.campaign);
    entry.leads++;
    if (row.status === "won") entry.won++;
    if (row.status === "lost") entry.lost++;
  }
  for (const row of ads) {
    const id = campaignKey({ campaignKey: row.campaignKey, campaign: row.campaign });
    if (id) campaign(id, row.campaign).spend += row.spend;
  }
  for (const row of paid) {
    const id = campaignKey({ campaignKey: row.campaignKey, campaignName: row.campaignName });
    if (id) campaign(id, row.campaignName).revenue += row.usdPaid;
  }

  const courseNames = focusCourse ? [focusCourse] : courses;
  const courseRows = courseNames
    .map((course) => {
      const cohort = leads.filter((row) => key(row.course) === key(course));
      const coursePaid = paid.filter((row) => key(canonicalCourse(row.course)) === key(course));
      const courseSpend = focusOwner
        ? null
        : ads
            .filter(
              (row) =>
                key(canonicalCourse(attributedAdCourse(row, data.snapshot).course)) === key(course),
            )
            .reduce((sum, row) => sum + row.spend, 0);
      const courseRevenue = coursePaid.reduce((sum, row) => sum + row.usdPaid, 0);
      const target = targetForCourse(course, plans, data.applied.from || "", data.applied.to || "");
      const courseWon = cohort.filter((row) => row.status === "won").length;
      const courseLost = cohort.filter((row) => row.status === "lost").length;
      return {
        course,
        target: focusOwner ? null : target.target,
        expectedLeads: focusOwner ? null : target.expected,
        targetCoverage: focusOwner ? "target_not_allocated_to_salesperson" : target.coverage,
        dailyTarget: focusOwner ? null : target.daily,
        leads: cohort.length,
        won: courseWon,
        lost: courseLost,
        open: cohort.length - courseWon - courseLost,
        spend: courseSpend,
        revenue: courseRevenue,
        roas: courseSpend === null ? null : ratio(courseRevenue, courseSpend),
        achievement: focusOwner ? null : ratio(cohort.length, target.target ?? 0),
      };
    })
    .filter((row) => row.leads || row.spend || row.revenue || row.target !== null)
    .sort((a, b) => b.leads - a.leads || a.course.localeCompare(b.course));

  const dailyMap = new Map<string, number>();
  for (const row of leads) {
    const day = dateOnly(row.createdAt);
    if (day) dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }
  const dates: string[] = [];
  const from = data.applied.from || "";
  const to = data.applied.to || "";
  const span = daysBetween(from, to);
  if (span !== null && span <= 1500) {
    const start = Date.parse(`${from}T00:00:00Z`);
    for (let offset = 0; offset <= span; offset++) {
      dates.push(new Date(start + offset * 86_400_000).toISOString().slice(0, 10));
    }
  } else dates.push(...[...dailyMap.keys()].sort());
  const daily = dates.map((day) => ({
    day,
    leads: dailyMap.get(day) ?? 0,
    target: focusOwner
      ? null
      : courseRows.reduce<number | null>((sum, row) => {
          const dayTarget = targetForCourse(row.course, plans, day, day).expected;
          if (dayTarget === null) return null;
          return sum === null ? null : sum + dayTarget;
        }, 0),
  }));

  const closed = leads
    .filter((row) => row.status !== "open")
    .map((row) => ({
      ...row,
      closeDays: row.closeDays ?? daysBetween(row.createdAt, row.closedAt),
    }));
  const measured = closed
    .map((row) => row.closeDays)
    .filter((value): value is number => value !== null);
  const sorted = [...measured].sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
    : null;
  const bucketSpecs: Array<[string, number, number]> = [
    ["0–30", 0, 30],
    ["31–60", 31, 60],
    ["61–90", 61, 90],
    ["91–180", 91, 180],
    ["180+", 181, Infinity],
  ];
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(closed.length / pageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const records = closed
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice((safePage - 1) * pageSize, safePage * pageSize)
    .map(({ id, course, owner, status, createdAt, closedAt, closeDays, odooUrl }) => ({
      id,
      course,
      owner,
      status,
      createdAt,
      closedAt,
      closeDays,
      odooUrl,
    }));

  const matrix = new Map<
    string,
    { course: string; owner: string; leads: number; won: number; lost: number; open: number }
  >();
  for (const row of leads) {
    if (!row.course || !row.owner) continue;
    const id = `${key(row.course)}\u001f${key(row.owner)}`;
    const entry = matrix.get(id) ?? {
      course: row.course,
      owner: row.owner,
      leads: 0,
      won: 0,
      lost: 0,
      open: 0,
    };
    entry.leads++;
    entry[row.status]++;
    matrix.set(id, entry);
  }
  const courseBenchmark = new Map<string, { won: number; leads: number }>();
  for (const row of allLeads.filter((lead) => matchesCourse(lead.course))) {
    const id = key(row.course);
    if (!id) continue;
    const count = courseBenchmark.get(id) ?? { won: 0, leads: 0 };
    count.leads++;
    if (row.status === "won") count.won++;
    courseBenchmark.set(id, count);
  }
  const salespeople = [...matrix.values()]
    .map((row) => {
      const decided = row.won + row.lost;
      const benchmark = courseBenchmark.get(key(row.course));
      const baseline = ratio(benchmark?.won ?? 0, benchmark?.leads ?? 0) ?? 0;
      return {
        ...row,
        settledRate: ratio(row.won, decided),
        leadRate: ratio(row.won, row.leads),
        verdict: (row.leads < 10 || decided < 5
          ? "insufficient"
          : row.won / row.leads >= baseline && row.won > 0
            ? "grow"
            : "review") as "grow" | "review" | "insufficient",
      };
    })
    .sort((a, b) => b.leads - a.leads || b.won - a.won);

  return {
    filters: { courses, owners, course: focusCourse, owner: focusOwner },
    period: { from: data.applied.from || "", to: data.applied.to || "" },
    totals: {
      leads: leads.length,
      won,
      lost: lostCount,
      open: leads.length - won - lostCount,
      spend,
      revenue,
      cpl: spend === null ? null : ratio(spend, leads.length),
      cac: spend === null ? null : ratio(spend, won),
      roas: spend === null ? null : ratio(revenue, spend),
      roi: spend && spend > 0 ? (revenue - spend) / spend : null,
      observedLtv: ratio(lifetimeRevenue, customers.size),
      payingCustomers: customers.size,
      attributedLeads: leads.filter((row) => Boolean(row.campaignKey || row.campaign)).length,
    },
    courses: courseRows,
    daily,
    campaigns: [...campaignMap.values()]
      .map((row) => ({
        name: row.name,
        leads: row.leads,
        won: row.won,
        lost: row.lost,
        spend: focusOwner ? null : row.spend,
        revenue: row.revenue,
        cpl: focusOwner ? null : ratio(row.spend, row.leads),
        roas: focusOwner ? null : ratio(row.revenue, row.spend),
      }))
      .sort((a, b) => b.leads - a.leads || (b.spend ?? 0) - (a.spend ?? 0)),
    lifecycle: {
      buckets: bucketSpecs.map(([label, min, max]) => ({
        label,
        count: measured.filter((value) => value >= min && value <= max).length,
      })),
      averageDays: measured.length
        ? measured.reduce((sum, value) => sum + value, 0) / measured.length
        : null,
      medianDays: median,
      sample: measured.length,
      missingCloseDate: closed.length - measured.length,
      records,
      total: closed.length,
      page: safePage,
      pages: totalPages,
    },
    salespeople,
    notes: [
      "Lead cohort uses Odoo creation date; Won/Lost are the current outcomes of that cohort.",
      "Revenue uses paid invoice date, so it is period revenue rather than revenue from the same lead cohort.",
      "Observed LTV is all-time paid revenue divided by distinct named paying partners; it is a proxy, not predicted lifetime value.",
      ...(focusOwner
        ? [
            "Ad spend is not allocated to salespeople; CPL, CAC, ROAS and ROI are unavailable with an owner filter.",
          ]
        : []),
    ],
  };
}
