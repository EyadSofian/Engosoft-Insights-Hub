import type { GlobalFilters, TeamAgg } from "./types";
import type { FilteredData } from "./metrics.server";
import { accountingReportingDate } from "./accounting-policy";
import { normalizePersonName } from "./person-name.ts";
import {
  MIN_DECIDED_SHARE,
  MIN_INSIGHT_LEADS,
  rankCourseInsights,
  type BestReason,
  type SupportReason,
} from "./course-insight.ts";
import { targetMonths, targetsByPerson, windowTarget } from "./sales-targets.ts";
import {
  getSlaSnapshot,
  type SlaRepMonthly,
  type SlaSalesSummary,
} from "./sla.server";

export interface AgentAnalyticsRow {
  key: string;
  name: string;
  team: string;
  paidRevenue: number;
  invoices: number;
  cleanLeads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  lostRate: number | null;
  avgCloseDays: number | null;
  closeSample: number;
  openLeads: number;
  newLeads: number;
  contactedLeads: number;
  uncontactedLeads: number;
  outboundCalls: number | null;
  answeredCalls: number | null;
  answerRate: number | null;
  contactRate: number | null;
  talkSeconds: number | null;
  avgFirstCallMinutes: number | null;
  slaWon: number;
  slaLost: number;
  decidedConversionRate: number | null;
  operationalSales: number | null;
  operationalUntaxed: number | null;
  operationalDeals: number | null;
  quotations: number | null;
  pipeline: number | null;
  slaMonths: number;
  courseProfile: AgentCourseProfile;
  /** Published quota for this window, or `null` when none is published. */
  target: AgentTarget | null;
}

export interface AgentTarget {
  employeeId: string;
  /** Workbook spelling, kept so a renamed employee is still recognisable. */
  name: string;
  teamLeader: string;
  supervisor: string;
  branch: string;
  note: string;
  /**
   * The published quota, whole. `null` means no month in the window publishes
   * one — deliberately not `0`, which would read as a real quota the employee
   * failed to meet.
   */
  target: number | null;
  /**
   * What the elapsed days imply should be collected by now. A pace marker
   * beside the real quota, never the denominator of achievement.
   */
  expectedToDate: number | null;
  monthsCovered: string[];
  /** Months the window spans with no published target at all. */
  monthsMissing: string[];
  /** False when part of the window has no target — the ratio is then partial. */
  complete: boolean;
  /** True when the window covers every published month end to end. */
  wholeMonths: boolean;
  /** Paid collections ÷ the whole quota, %. */
  achievementPaid: number | null;
  /** Odoo's operational sales ÷ the whole quota, %. */
  achievementOperational: number | null;
  /** Remaining amount on each basis. Negative once the quota is beaten. */
  gapPaid: number | null;
  gapOperational: number | null;
  /**
   * Paid collections against the pace marker, %. Above 100 means ahead of
   * schedule for the days elapsed — which is a different statement from having
   * hit the quota, and is labelled as such.
   */
  pacePaid: number | null;
  /** Amount still owed against the pace marker. Negative when ahead. */
  paceGapPaid: number | null;
}

export interface TargetCoverage {
  /** Months that publish a quota at all. */
  publishedMonths: string[];
  /** Employees in the current selection matched to a published quota. */
  matched: number;
  /** Whole published quota across every matched employee. */
  totalTarget: number | null;
  /** What the elapsed days imply should be collected by now. Pace only. */
  totalExpectedToDate: number | null;
  totalPaidRevenue: number;
  /** Collections ÷ the whole quota, %. */
  totalAchievementPaid: number | null;
  /** Collections ÷ the pace marker, %. Above 100 = ahead of schedule. */
  totalPacePaid: number | null;
  /** False when the window spans a month with no published quota. */
  complete: boolean;
  wholeMonths: boolean;
  monthsMissing: string[];
  /**
   * Published quotas with no employee anywhere in the data. Either the person
   * produced nothing at all this period, or the workbook spells their name
   * differently from Odoo and needs an alias — both must be named, never
   * silently dropped.
   */
  unmatched: { employeeId: string; name: string; teamLeader: string; target: number | null }[];
  /** People selling in this window with no published quota. */
  untargeted: { name: string; paidRevenue: number }[];
  /** Workbook contradictions, e.g. one name resolving to two employees. */
  duplicates: string[];
}

export interface AgentCoursePerformance {
  key: string;
  label: string;
  mainCategory: string;
  leads: number;
  won: number;
  lost: number;
  openLeads: number;
  paidRevenue: number;
  invoices: number;
  leadShare: number;
  salesShare: number;
  conversionRate: number | null;
  decidedConversionRate: number | null;
  sampleStatus: "reliable" | "insufficient";
}

export interface AgentSpecializationPerformance {
  key: string;
  label: string;
  leads: number;
  won: number;
  lost: number;
  openLeads: number;
  paidRevenue: number;
  invoices: number;
  leadShare: number;
  salesShare: number;
  conversionRate: number | null;
  decidedConversionRate: number | null;
  sampleStatus: "reliable" | "insufficient";
}

export interface AgentCourseProfile {
  courses: AgentCoursePerformance[];
  specializations: AgentSpecializationPerformance[];
  bestSellingCourse: AgentCoursePerformance | null;
  leastSellingCourse: AgentCoursePerformance | null;
  bestConvertingCourse: AgentCoursePerformance | null;
  needsSupportCourse: AgentCoursePerformance | null;
  /** Why the strength card is empty — small cohort, or no win landed yet. */
  bestReason: BestReason;
  /** Why the weakness card is empty — small cohort, or still being worked. */
  needsSupportReason: SupportReason;
  minimumLeadSample: number;
  minimumDecidedSample: number;
  /** Share of a cohort that must be decided before a course can be called weak. */
  minimumDecidedShare: number;
  lostDataAvailable: boolean;
}

export interface AgentAnalyticsResult {
  agents: AgentAnalyticsRow[];
  months: string[];
  selected: {
    from?: string;
    to?: string;
    dateBasis: "payment" | "invoice";
    company: string;
  };
  summary: {
    agents: number;
    paidRevenue: number;
    invoices: number;
    cleanLeads: number;
    won: number;
    lost: number;
    conversionRate: number | null;
    periodClosedWon: number;
    periodClosedLost: number;
    decidedConversionRate: number | null;
    outboundCalls: number | null;
    answeredCalls: number | null;
    answerRate: number | null;
  };
  targets: TargetCoverage;
  sla: {
    ok: boolean;
    source: string;
    fetchedAt: string;
    error?: string;
    grain: "day";
    callsThrough: string;
    salesThrough: string;
    callsAvailable: boolean;
    salesAvailable: boolean;
  };
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export { normalizePersonName };

const monthKey = (value: string): string => value.slice(0, 7);

function monthEnd(month: string): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return `${month}-31`;
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

function monthIncluded(monthValue: string, filters: GlobalFilters): boolean {
  const exactDate = monthValue.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(exactDate)) {
    if (filters.from && exactDate < filters.from) return false;
    if (filters.to && exactDate > filters.to) return false;
    return true;
  }
  const month = monthKey(monthValue);
  if (!month) return false;
  const start = `${month}-01`;
  const end = monthEnd(month);
  if (filters.from && end < filters.from) return false;
  if (filters.to && start > filters.to) return false;
  return true;
}

function normalizedEquals(left: string | null | undefined, right: string | undefined): boolean {
  if (!right) return true;
  return normalizePersonName(left || "") === normalizePersonName(right);
}

function slaRowIncluded(
  row: { month: string; user_name?: string | null },
  filters: GlobalFilters,
): boolean {
  if (!monthIncluded(row.month, filters)) return false;
  if (!normalizedEquals(row.user_name, filters.salesperson)) return false;
  return true;
}

function latestMetricMonth<T extends { month: string }>(
  rows: T[],
  hasMetric: (row: T) => boolean,
): string {
  return rows
    .filter(hasMetric)
    .map((row) => monthKey(row.month))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

interface MutableAgent extends AgentAnalyticsRow {
  teams: Set<string>;
  firstCallWeighted: number;
  firstCallWeight: number;
  invoiceRefs: Set<string>;
  months: Set<string>;
  latestOpenMonth: string;
}

interface MutableDimension {
  key: string;
  label: string;
  mainCategory: string;
  categoryWeight: Map<string, number>;
  leads: number;
  won: number;
  lost: number;
  paidRevenue: number;
  invoiceRefs: Set<string>;
}

interface MutableAgentProfile {
  courses: Map<string, MutableDimension>;
  specializations: Map<string, MutableDimension>;
}

const MINIMUM_LEAD_SAMPLE = MIN_INSIGHT_LEADS;
const MINIMUM_DECIDED_SAMPLE = 5;

const blankCourseProfile = (lostDataAvailable = true): AgentCourseProfile => ({
  courses: [],
  specializations: [],
  bestSellingCourse: null,
  leastSellingCourse: null,
  bestConvertingCourse: null,
  needsSupportCourse: null,
  bestReason: "no_sample",
  needsSupportReason: "no_sample",
  minimumLeadSample: MINIMUM_LEAD_SAMPLE,
  minimumDecidedSample: MINIMUM_DECIDED_SAMPLE,
  minimumDecidedShare: MIN_DECIDED_SHARE,
  lostDataAvailable,
});

const blank = (key: string, name: string): MutableAgent => ({
  key,
  name,
  team: "—",
  teams: new Set(),
  paidRevenue: 0,
  invoices: 0,
  cleanLeads: 0,
  won: 0,
  lost: 0,
  conversionRate: null,
  lostRate: null,
  avgCloseDays: null,
  closeSample: 0,
  openLeads: 0,
  newLeads: 0,
  contactedLeads: 0,
  uncontactedLeads: 0,
  outboundCalls: 0,
  answeredCalls: 0,
  answerRate: null,
  contactRate: null,
  talkSeconds: 0,
  avgFirstCallMinutes: null,
  slaWon: 0,
  slaLost: 0,
  decidedConversionRate: null,
  operationalSales: 0,
  operationalUntaxed: 0,
  operationalDeals: 0,
  quotations: 0,
  pipeline: 0,
  slaMonths: 0,
  courseProfile: blankCourseProfile(),
  target: null,
  firstCallWeighted: 0,
  firstCallWeight: 0,
  invoiceRefs: new Set(),
  months: new Set(),
  latestOpenMonth: "",
});

const normalizeDimension = (value: string): string =>
  value
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const cleanDimensionLabel = (value: string): string => value.trim() || "Uncategorized";
const cleanCategoryLabel = (value: string): string =>
  cleanDimensionLabel(value).replace(/^revenue\s*\/\s*miscellaneous\s*\/\s*/i, "");

function profileFor(map: Map<string, MutableAgentProfile>, person: string) {
  const key = normalizePersonName(person);
  if (!key) return null;
  let profile = map.get(key);
  if (!profile) {
    profile = { courses: new Map(), specializations: new Map() };
    map.set(key, profile);
  }
  return profile;
}

function dimensionFor(
  map: Map<string, MutableDimension>,
  labelValue: string,
  mainCategoryValue = "",
) {
  const label = cleanDimensionLabel(labelValue);
  const key = normalizeDimension(label) || "uncategorized";
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      label,
      mainCategory: cleanDimensionLabel(mainCategoryValue),
      categoryWeight: new Map(),
      leads: 0,
      won: 0,
      lost: 0,
      paidRevenue: 0,
      invoiceRefs: new Set(),
    };
    map.set(key, row);
  }
  const category = cleanDimensionLabel(mainCategoryValue);
  row.categoryWeight.set(category, (row.categoryWeight.get(category) ?? 0) + 1);
  return row;
}

function addLeadToProfile(
  profiles: Map<string, MutableAgentProfile>,
  source: {
    salesperson: string;
    course: string;
    mainCategory: string;
  },
  outcome: "won" | "lost" | "open",
) {
  const profile = profileFor(profiles, source.salesperson);
  if (!profile) return;
  const category = cleanCategoryLabel(source.mainCategory);
  const course = dimensionFor(profile.courses, source.course, category);
  const specialization = dimensionFor(profile.specializations, category, category);
  for (const row of [course, specialization]) {
    row.leads += 1;
    if (outcome === "won") row.won += 1;
    if (outcome === "lost") row.lost += 1;
  }
}

function addSaleToProfile(
  profiles: Map<string, MutableAgentProfile>,
  source: {
    salesperson: string;
    course: string;
    mainCategory: string;
    productCategory: string;
    category: string;
    usdPaid: number;
    movement: string;
    isCreditNote: boolean;
  },
) {
  const profile = profileFor(profiles, source.salesperson);
  if (!profile) return;
  const category = cleanCategoryLabel(
    source.mainCategory || source.productCategory || source.category,
  );
  const courseLabel = source.course || source.productCategory || source.category;
  const course = dimensionFor(profile.courses, courseLabel, category);
  const specialization = dimensionFor(profile.specializations, category, category);
  for (const row of [course, specialization]) {
    row.paidRevenue += source.usdPaid;
    if (source.movement && !source.isCreditNote) row.invoiceRefs.add(source.movement);
  }
}

function finishDimension(
  source: MutableDimension,
  totalLeads: number,
  positiveRevenue: number,
  lostDataAvailable: boolean,
): AgentCoursePerformance {
  const decided = source.won + source.lost;
  const mainCategory = [...source.categoryWeight.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0] || source.mainCategory;
  const base = {
    key: source.key,
    label: source.label,
    mainCategory,
    leads: source.leads,
    won: source.won,
    lost: source.lost,
    openLeads: Math.max(0, source.leads - decided),
    paidRevenue: source.paidRevenue,
    invoices: source.invoiceRefs.size,
    leadShare: totalLeads > 0 ? (source.leads / totalLeads) * 100 : 0,
    salesShare:
      positiveRevenue > 0 && source.paidRevenue > 0
        ? (source.paidRevenue / positiveRevenue) * 100
        : 0,
    conversionRate: source.leads > 0 ? (source.won / source.leads) * 100 : null,
    decidedConversionRate: decided > 0 ? (source.won / decided) * 100 : null,
    sampleStatus:
      lostDataAvailable &&
      source.leads >= MINIMUM_LEAD_SAMPLE &&
      decided >= MINIMUM_DECIDED_SAMPLE
        ? ("reliable" as const)
        : ("insufficient" as const),
  };
  return base;
}

function buildCourseProfiles(data: FilteredData): Map<string, AgentCourseProfile> {
  const mutable = new Map<string, MutableAgentProfile>();
  const lostDataAvailable = data.snapshot.health.lostAuthority !== "unavailable";
  for (const lead of data.crm) {
    addLeadToProfile(mutable, lead, lead.isWon ? "won" : "open");
  }

  const seenArchived = new Set<string>();
  for (const lead of data.lost) {
    const id = lead.id || `${lead.salesperson}|${lead.createdAt}|${lead.contact}`;
    if (seenArchived.has(id)) continue;
    seenArchived.add(id);
    addLeadToProfile(
      mutable,
      lead,
      lead.stage.trim().toLocaleLowerCase("en") === "won" ? "open" : "lost",
    );
  }
  for (const invoice of data.accounting) addSaleToProfile(mutable, invoice);

  const profiles = new Map<string, AgentCourseProfile>();
  for (const [personKey, profile] of mutable) {
    const totalLeads = [...profile.courses.values()].reduce((sum, row) => sum + row.leads, 0);
    const positiveRevenue = [...profile.courses.values()].reduce(
      (sum, row) => sum + Math.max(0, row.paidRevenue),
      0,
    );
    const courses = [...profile.courses.values()]
      .map((row) => finishDimension(row, totalLeads, positiveRevenue, lostDataAvailable))
      .sort(
        (left, right) =>
          right.paidRevenue - left.paidRevenue || right.leads - left.leads ||
          left.label.localeCompare(right.label),
      );

    const specializationLeads = [...profile.specializations.values()].reduce(
      (sum, row) => sum + row.leads,
      0,
    );
    const specializationRevenue = [...profile.specializations.values()].reduce(
      (sum, row) => sum + Math.max(0, row.paidRevenue),
      0,
    );
    const specializations = [...profile.specializations.values()]
      .map((row) => {
        const finished = finishDimension(
          row,
          specializationLeads,
          specializationRevenue,
          lostDataAvailable,
        );
        const { mainCategory: _mainCategory, ...specialization } = finished;
        return specialization;
      })
      .sort(
        (left, right) =>
          right.leads - left.leads || right.paidRevenue - left.paidRevenue ||
          left.label.localeCompare(right.label),
      );

    const sellingCourses = courses.filter((row) => row.invoices > 0 || row.paidRevenue !== 0);
    const reliableCourses = courses.filter((row) => row.sampleStatus === "reliable");
    const bestSellingCourse = sellingCourses[0] ?? null;
    const leastSellingCourse =
      sellingCourses.length > 1
        ? [...sellingCourses].sort(
            (left, right) =>
              left.paidRevenue - right.paidRevenue || left.invoices - right.invoices,
          )[0]
        : null;
    const {
      best: bestConvertingCourse,
      needsSupport: needsSupportCourse,
      bestReason,
      needsSupportReason,
    } = rankCourseInsights(courses);

    profiles.set(personKey, {
      courses,
      specializations,
      bestSellingCourse,
      leastSellingCourse,
      bestConvertingCourse,
      needsSupportCourse,
      bestReason,
      needsSupportReason,
      minimumLeadSample: MINIMUM_LEAD_SAMPLE,
      minimumDecidedSample: MINIMUM_DECIDED_SAMPLE,
      minimumDecidedShare: MIN_DECIDED_SHARE,
      lostDataAvailable,
    });
  }
  return profiles;
}

function mergeMainPeople(map: Map<string, MutableAgent>, teams: TeamAgg[]) {
  for (const team of teams) {
    for (const person of team.people ?? []) {
      if (!person.name || person.name === "—") continue;
      const key = normalizePersonName(person.name);
      if (!key) continue;
      const row = map.get(key) ?? blank(key, person.name);
      row.teams.add(team.name);
      row.paidRevenue += person.revenue;
      row.cleanLeads += person.crmLeads;
      row.won += person.won;
      row.lost += person.lost;
      row.closeSample += person.closeSample;
      if (person.avgCloseDays !== null)
        row.avgCloseDays =
          ((row.avgCloseDays ?? 0) * Math.max(0, row.closeSample - person.closeSample) +
            person.avgCloseDays * person.closeSample) /
          Math.max(1, row.closeSample);
      map.set(key, row);
    }
  }
}

function mergeInvoiceRefs(map: Map<string, MutableAgent>, data: FilteredData) {
  for (const invoice of data.accounting) {
    if (!invoice.salesperson || !invoice.movement) continue;
    const key = normalizePersonName(invoice.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, invoice.salesperson);
    if (!invoice.isCreditNote) row.invoiceRefs.add(invoice.movement);
    if (invoice.salesTeam) row.teams.add(invoice.salesTeam);
    map.set(key, row);
  }
}

function mergeSlaRep(map: Map<string, MutableAgent>, rows: SlaRepMonthly[]) {
  for (const source of rows) {
    const key = normalizePersonName(source.user_name || "");
    if (!key) continue;
    const row = map.get(key) ?? blank(key, source.user_name);
    const month = monthKey(source.month);
    row.months.add(month);
    if (source.team_name) row.teams.add(source.team_name);
    if (month >= row.latestOpenMonth) {
      row.latestOpenMonth = month;
      row.openLeads = num(source.open_leads);
    }
    row.newLeads += num(source.new_leads);
    row.contactedLeads += num(source.contacted_leads);
    row.uncontactedLeads += num(source.uncontacted_leads);
    row.outboundCalls = (row.outboundCalls ?? 0) + num(source.outbound_calls);
    row.answeredCalls = (row.answeredCalls ?? 0) + num(source.answered_calls);
    row.talkSeconds = (row.talkSeconds ?? 0) + num(source.talk_sec);
    row.slaWon += num(source.won_leads);
    row.slaLost += num(source.lost_leads);
    if (source.avg_first_call_minutes !== null && num(source.contacted_leads) > 0) {
      row.firstCallWeighted += num(source.avg_first_call_minutes) * num(source.contacted_leads);
      row.firstCallWeight += num(source.contacted_leads);
    }
    map.set(key, row);
  }
}

function mergeSlaSales(map: Map<string, MutableAgent>, rows: SlaSalesSummary[]) {
  for (const source of rows) {
    const key = normalizePersonName(source.user_name || "");
    if (!key) continue;
    const row = map.get(key) ?? blank(key, source.user_name || "—");
    if (source.team_name) row.teams.add(source.team_name);
    row.months.add(monthKey(source.month));
    row.operationalSales = (row.operationalSales ?? 0) + num(source.achieved_total);
    row.operationalUntaxed = (row.operationalUntaxed ?? 0) + num(source.achieved_untaxed);
    row.operationalDeals = (row.operationalDeals ?? 0) + num(source.deals_count);
    row.quotations = (row.quotations ?? 0) + num(source.quotations_count);
    row.pipeline = (row.pipeline ?? 0) + num(source.pipeline_value);
    map.set(key, row);
  }
}

function dateIncluded(value: string, filters: GlobalFilters): boolean {
  if (!value) return false;
  if (filters.from && value < filters.from) return false;
  if (filters.to && value > filters.to) return false;
  return true;
}

/**
 * Operational closures are dated by their actual close date. This is separate
 * from marketing cohort conversion, where Won/Lost belongs to the lead's
 * creation month. Mixing the two was why an early month looked artificially
 * weak on the employee page.
 */
function mergeOperationalClosures(
  map: Map<string, MutableAgent>,
  data: FilteredData,
  filters: GlobalFilters,
) {
  const sourceKey = filters.source?.trim().toLocaleLowerCase("en") || "";
  const platformCampaigns = filters.platform
    ? new Set(
        data.snapshot.ads
          .filter((row) => row.platform === filters.platform)
          .map((row) => row.campaignKey),
      )
    : null;
  const commonMatch = (row: {
    campaignName: string;
    campaignKey: string;
    sourceKey: string;
    course: string;
    mainCategory: string;
    salesperson: string;
  }) => {
    if (filters.platform && !platformCampaigns?.has(row.campaignKey)) return false;
    if (filters.campaign && row.campaignName !== filters.campaign) return false;
    if (filters.campaignKey && row.campaignKey !== filters.campaignKey) return false;
    if (sourceKey && row.sourceKey !== sourceKey) return false;
    if (filters.course && row.course !== filters.course) return false;
    if (filters.mainCategory && row.mainCategory !== filters.mainCategory) return false;
    if (!normalizedEquals(row.salesperson, filters.salesperson)) return false;
    return true;
  };

  for (const lead of data.snapshot.crm) {
    if (!lead.isWon || !dateIncluded(lead.closedAt, filters) || !commonMatch(lead)) continue;
    if (
      filters.salesTeam &&
      !normalizedEquals(lead.salesTeam, filters.salesTeam) &&
      !normalizedEquals(lead.subTeam, filters.salesTeam)
    )
      continue;
    const key = normalizePersonName(lead.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, lead.salesperson);
    if (lead.salesTeam) row.teams.add(lead.salesTeam);
    row.slaWon += 1;
    map.set(key, row);
  }

  for (const lead of data.snapshot.lost) {
    if (!dateIncluded(lead.closeDate, filters) || !commonMatch(lead)) continue;
    if (filters.salesTeam && !normalizedEquals(lead.salesTeam, filters.salesTeam)) continue;
    const key = normalizePersonName(lead.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, lead.salesperson);
    if (lead.salesTeam) row.teams.add(lead.salesTeam);
    row.slaLost += 1;
    map.set(key, row);
  }
}

/**
 * Attaches the published quota to each selected employee.
 *
 * Two rules keep this honest:
 *
 * - **Never divide by a quota that does not exist.** A window with no published
 *   target yields `null`, which renders as an em dash. Returning `0` would make
 *   every employee read as having missed a target nobody set.
 * - **Never resolve a name by guessing.** Only the workbook spelling and its
 *   declared aliases match. Anything left over is reported in `unmatched` so a
 *   renamed employee shows up as a question instead of a silent zero.
 *
 * `allAgents` is the unfiltered population on purpose: a quota whose owner is
 * merely outside the current team filter is not a data problem, and must not be
 * reported as one.
 */
function buildTargetCoverage(
  agents: AgentAnalyticsRow[],
  allAgents: MutableAgent[],
  filters: GlobalFilters,
): TargetCoverage {
  const { byName, duplicates } = targetsByPerson();
  const publishedMonths = targetMonths();

  const matchedEmployeeIds = new Set<string>();
  for (const row of agents) {
    const person = byName.get(normalizePersonName(row.name));
    if (!person) continue;
    const resolved = windowTarget(person.monthly, filters.from, filters.to);
    const { target, expectedToDate } = resolved;
    // Achievement always divides by the whole published quota. The pace marker
    // is reported separately so "ahead of schedule" can never be mistaken for
    // "target met".
    const share = (value: number | null): number | null =>
      target !== null && target > 0 && value !== null ? (value / target) * 100 : null;
    const gap = (value: number | null): number | null =>
      target !== null && value !== null ? target - value : null;

    matchedEmployeeIds.add(person.entry.employeeId);
    row.target = {
      employeeId: person.entry.employeeId,
      name: person.entry.name,
      teamLeader: person.entry.teamLeader,
      supervisor: person.entry.supervisor,
      branch: person.entry.branch,
      note: person.entry.note,
      target,
      expectedToDate,
      monthsCovered: resolved.monthsCovered,
      monthsMissing: resolved.monthsMissing,
      complete: resolved.complete,
      wholeMonths: resolved.wholeMonths,
      achievementPaid: share(row.paidRevenue),
      achievementOperational: share(row.operationalSales),
      gapPaid: gap(row.paidRevenue),
      gapOperational: gap(row.operationalSales),
      pacePaid:
        expectedToDate !== null && expectedToDate > 0
          ? (row.paidRevenue / expectedToDate) * 100
          : null,
      paceGapPaid: expectedToDate !== null ? expectedToDate - row.paidRevenue : null,
    };
  }

  // Measured against everyone in the data, so a team filter cannot manufacture
  // a "missing employee" warning.
  const knownNames = new Set(allAgents.map((row) => normalizePersonName(row.name)));
  const unmatched: TargetCoverage["unmatched"] = [];
  const seenUnmatched = new Set<string>();
  for (const person of byName.values()) {
    if (seenUnmatched.has(person.entry.employeeId)) continue;
    seenUnmatched.add(person.entry.employeeId);
    // An employee the workbook deliberately leaves untargeted is not missing.
    if (person.monthly.every((month) => month.target === null)) continue;
    const found = [person.entry.name, ...person.entry.aliases].some((name) =>
      knownNames.has(normalizePersonName(name)),
    );
    if (found) continue;
    unmatched.push({
      employeeId: person.entry.employeeId,
      name: person.entry.name,
      teamLeader: person.entry.teamLeader,
      target: windowTarget(person.monthly, filters.from, filters.to).target,
    });
  }

  const targeted = agents.filter((row) => row.target?.target !== null && row.target !== null);
  const totalTarget = targeted.length
    ? targeted.reduce((sum, row) => sum + (row.target?.target ?? 0), 0)
    : null;
  const totalExpectedToDate = targeted.length
    ? targeted.reduce((sum, row) => sum + (row.target?.expectedToDate ?? 0), 0)
    : null;
  const totalPaidRevenue = targeted.reduce((sum, row) => sum + row.paidRevenue, 0);

  return {
    publishedMonths,
    matched: matchedEmployeeIds.size,
    totalTarget,
    totalExpectedToDate,
    totalPaidRevenue,
    totalAchievementPaid:
      totalTarget !== null && totalTarget > 0 ? (totalPaidRevenue / totalTarget) * 100 : null,
    totalPacePaid:
      totalExpectedToDate !== null && totalExpectedToDate > 0
        ? (totalPaidRevenue / totalExpectedToDate) * 100
        : null,
    complete: targeted.every((row) => row.target?.complete ?? false),
    wholeMonths: targeted.every((row) => row.target?.wholeMonths ?? false),
    monthsMissing: [...new Set(targeted.flatMap((row) => row.target?.monthsMissing ?? []))].sort(),
    unmatched: unmatched.sort((left, right) => (right.target ?? 0) - (left.target ?? 0)),
    untargeted: agents
      .filter((row) => !row.target && row.paidRevenue !== 0)
      .map((row) => ({ name: row.name, paidRevenue: row.paidRevenue }))
      .sort((left, right) => right.paidRevenue - left.paidRevenue),
    duplicates,
  };
}

export async function buildAgentAnalytics(
  data: FilteredData,
  filters: GlobalFilters,
  teams: TeamAgg[],
): Promise<AgentAnalyticsResult> {
  const map = new Map<string, MutableAgent>();
  const availableMonths = new Set<string>();
  const dateBasis = filters.dateBasis === "invoice" ? "invoice" : "payment";
  for (const invoice of data.snapshot.accounting) {
    if (filters.company && invoice.company !== filters.company) continue;
    const date = accountingReportingDate(invoice, dateBasis);
    if (date) availableMonths.add(monthKey(date));
  }
  mergeMainPeople(map, teams);
  mergeInvoiceRefs(map, data);
  mergeOperationalClosures(map, data, filters);
  const courseProfiles = buildCourseProfiles(data);

  let slaStatus: AgentAnalyticsResult["sla"] = {
    ok: false,
    source: "Railway PostgreSQL · Yeastar",
    fetchedAt: "",
    grain: "day",
    callsThrough: "",
    salesThrough: "",
    callsAvailable: false,
    salesAvailable: false,
  };
  try {
    const snapshot = await Promise.race([
      getSlaSnapshot(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (!snapshot) {
      throw new Error(
        "Yeastar calls are still refreshing in Railway. Odoo accounting and CRM figures remain available.",
      );
    }
    for (const row of snapshot.repMonthly) if (row.month) availableMonths.add(monthKey(row.month));
    for (const row of snapshot.salesSummary)
      if (row.month) availableMonths.add(monthKey(row.month));
    // Yeastar knows the extension/employee, not the Odoo sales team. Filtering
    // SLA rows by `team_name` here used to remove every call whenever a team was
    // selected. Merge by employee first; the Odoo team membership is applied
    // below after all sources have been joined.
    const selectedRep = snapshot.repMonthly.filter((row) => slaRowIncluded(row, filters));
    const selectedSales = snapshot.salesSummary.filter((row) => slaRowIncluded(row, filters));
    const callsThrough = latestMetricMonth(
      snapshot.repMonthly,
      (row) => num(row.outbound_calls) > 0 || num(row.answered_calls) > 0 || num(row.talk_sec) > 0,
    );
    const salesThrough = latestMetricMonth(snapshot.salesSummary, () => true);
    mergeSlaRep(map, selectedRep);
    mergeSlaSales(map, selectedSales);
    slaStatus = {
      ok: true,
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      grain: "day",
      callsThrough,
      salesThrough,
      callsAvailable: false,
      salesAvailable: false,
    };
  } catch (error) {
    slaStatus.error = error instanceof Error ? error.message : String(error);
  }

  const selectedAgents = [...map.values()].filter((row) => {
    if (!normalizedEquals(row.name, filters.salesperson)) return false;
    if (
      filters.salesTeam &&
      ![...row.teams].some((team) => normalizedEquals(team, filters.salesTeam))
    )
      return false;
    return true;
  });
  if (slaStatus.ok) {
    slaStatus.callsAvailable = selectedAgents.some(
      (row) =>
        num(row.outboundCalls) > 0 || num(row.answeredCalls) > 0 || num(row.talkSeconds) > 0,
    );
    slaStatus.salesAvailable = selectedAgents.some(
      (row) =>
        num(row.operationalSales) !== 0 ||
        num(row.operationalDeals) > 0 ||
        num(row.quotations) > 0 ||
        num(row.pipeline) !== 0,
    );
  }

  const agents = selectedAgents
    .map((row): AgentAnalyticsRow => {
      row.invoices = row.invoiceRefs.size;
      row.team = [...row.teams].filter(Boolean).join(" · ") || "—";
      row.conversionRate = row.cleanLeads > 0 ? (row.won / row.cleanLeads) * 100 : null;
      row.lostRate = row.cleanLeads > 0 ? (row.lost / row.cleanLeads) * 100 : null;
      row.answerRate =
        (row.outboundCalls ?? 0) > 0
          ? ((row.answeredCalls ?? 0) / (row.outboundCalls ?? 1)) * 100
          : null;
      row.contactRate =
        row.newLeads > 0 ? (row.contactedLeads / row.newLeads) * 100 : null;
      row.decidedConversionRate =
        row.slaWon + row.slaLost > 0 ? (row.slaWon / (row.slaWon + row.slaLost)) * 100 : null;
      row.avgFirstCallMinutes =
        row.firstCallWeight > 0 ? row.firstCallWeighted / row.firstCallWeight : null;
      row.slaMonths = row.months.size;
      row.courseProfile =
        courseProfiles.get(row.key) ??
        blankCourseProfile(data.snapshot.health.lostAuthority !== "unavailable");
      if (!slaStatus.callsAvailable) {
        row.outboundCalls = null;
        row.answeredCalls = null;
        row.talkSeconds = null;
      }
      if (!slaStatus.salesAvailable) {
        row.operationalSales = null;
        row.operationalUntaxed = null;
        row.operationalDeals = null;
        row.quotations = null;
        row.pipeline = null;
      }
      return row;
    })
    .filter(
      (row) =>
        row.paidRevenue !== 0 ||
        row.invoices > 0 ||
        row.cleanLeads > 0 ||
        row.won > 0 ||
        row.lost > 0 ||
        row.newLeads > 0 ||
        row.contactedLeads > 0 ||
        row.slaWon > 0 ||
        row.slaLost > 0 ||
        (row.outboundCalls ?? 0) > 0 ||
        (row.answeredCalls ?? 0) > 0 ||
        (row.operationalSales ?? 0) !== 0 ||
        (row.operationalDeals ?? 0) > 0,
    )
    .sort((a, b) => b.paidRevenue - a.paidRevenue || b.cleanLeads - a.cleanLeads);

  const summary = agents.reduce(
    (acc, row) => {
      acc.paidRevenue += row.paidRevenue;
      acc.invoices += row.invoices;
      acc.cleanLeads += row.cleanLeads;
      acc.won += row.won;
      acc.lost += row.lost;
      acc.periodClosedWon += row.slaWon;
      acc.periodClosedLost += row.slaLost;
      if (row.outboundCalls !== null) acc.outboundCalls = (acc.outboundCalls ?? 0) + row.outboundCalls;
      if (row.answeredCalls !== null) acc.answeredCalls = (acc.answeredCalls ?? 0) + row.answeredCalls;
      return acc;
    },
    {
      agents: agents.length,
      paidRevenue: 0,
      invoices: 0,
      cleanLeads: 0,
      won: 0,
      lost: 0,
      periodClosedWon: 0,
      periodClosedLost: 0,
      conversionRate: null as number | null,
      decidedConversionRate: null as number | null,
      outboundCalls: slaStatus.callsAvailable ? 0 : (null as number | null),
      answeredCalls: slaStatus.callsAvailable ? 0 : (null as number | null),
      answerRate: null as number | null,
    },
  );
  summary.conversionRate =
    summary.cleanLeads > 0 ? (summary.won / summary.cleanLeads) * 100 : null;
  summary.decidedConversionRate =
    summary.periodClosedWon + summary.periodClosedLost > 0
      ? (summary.periodClosedWon / (summary.periodClosedWon + summary.periodClosedLost)) * 100
      : null;
  summary.answerRate =
    (summary.outboundCalls ?? 0) > 0
      ? ((summary.answeredCalls ?? 0) / (summary.outboundCalls ?? 1)) * 100
      : null;

  // After `agents` is final, so every row that reaches the screen carries its
  // quota, and before the response is built so coverage can be reported with it.
  const targets = buildTargetCoverage(agents, [...map.values()], filters);

  return {
    agents,
    targets,
    months: [...availableMonths].filter(Boolean).sort(),
    selected: {
      from: filters.from,
      to: filters.to,
      dateBasis,
      company: filters.company || "",
    },
    summary,
    sla: slaStatus,
  };
}
