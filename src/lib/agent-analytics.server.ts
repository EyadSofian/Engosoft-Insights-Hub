import type { GlobalFilters, TeamAgg } from "./types";
import type { FilteredData } from "./metrics.server";
import { accountingReportingDate } from "./accounting-policy";
import { normalizePersonName } from "./person-name.ts";
import { integrationPersonMatchScore } from "./integration-person.ts";
import { archivedWinFilter, isArchivedWonStage } from "./archived-won";
import {
  MIN_DECIDED_OUTCOMES,
  MIN_INSIGHT_LEADS,
  isCoachableCourse,
  isSoldCourse,
  rankCourseInsights,
  type BestReason,
  type SupportReason,
} from "./course-insight.ts";
import { targetMonths, targetsByPerson, windowTarget, type TargetSource } from "./sales-targets.ts";
import { loadTargetSource } from "./sales-targets.server";
import { getSlaSnapshot, type SlaRepMonthly, type SlaSalesSummary } from "./sla.server";
import { isOrganicSourceKey } from "./acquisition-channel";
import {
  chatwootConfigured,
  getChatwootAgentSnapshot,
  type ChatwootAgentMetric,
} from "./chatwoot.server";
import {
  getCallsHubLeadCalls,
  getCallsHubSummary,
  type CallsHubLeadCallAggregate,
  type CallsHubEmployeeSummary,
} from "./calls-hub.server";
import {
  calculateEmployeePerformanceScore,
  EMPLOYEE_SCORE_WEIGHTS,
  type AgentPerformanceScore,
} from "./employee-performance-score";
import { callCanCoverLead, leadCallAggregateKey } from "./uncalled-leads";

export type { AgentPerformanceScore } from "./employee-performance-score";

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
  /** Odoo leads currently assigned to the employee in the selected cohort. */
  distributedLeads: number;
  /** Assigned leads whose phone matched at least one PBX call in the window. */
  calledDistributedLeads: number | null;
  /** Assigned leads called by this employee, not merely by any PBX extension. */
  ownerCalledDistributedLeads: number | null;
  uncalledDistributedLeads: number | null;
  callsFromDistributedLeads: number | null;
  callsByAssignedEmployee: number | null;
  leadCallCoverageRate: number | null;
  /** Employee's own called assigned leads ÷ all leads assigned to them. */
  leadOwnerCallCoverageRate: number | null;
  /** Yeastar extension used to load the employee's call samples on demand. */
  callExtension: string | null;
  /** All inbound and outbound calls in the selected date window. */
  totalCalls: number | null;
  outboundCalls: number | null;
  answeredCalls: number | null;
  answerRate: number | null;
  contactRate: number | null;
  talkSeconds: number | null;
  totalCallSeconds: number | null;
  averageCallSeconds: number | null;
  analyzedCalls: number | null;
  averageQualityScore: number | null;
  qualityNeedsReview: number | null;
  chatConversations: number | null;
  chatResolved: number | null;
  chatUnreadConversations: number | null;
  chatUnreadMessages: number | null;
  chatAwaitingReply: number | null;
  chatAverageFirstResponseSeconds: number | null;
  chatAverageResolutionSeconds: number | null;
  chatAverageReplySeconds: number | null;
  /** Exact Chatwoot agent id used only to load conversation evidence on demand. */
  chatwootAgentId: number | null;
  avgFirstCallMinutes: number | null;
  slaWon: number;
  slaLost: number;
  decidedConversionRate: number | null;
  /**
   * Sale orders confirmed on his name in this window, in USD.
   *
   * The second revenue basis on the employee screen. Collections answer "what
   * was paid this month", which can be money from deals closed long before it;
   * orders answer "what did he sell this month". They disagree exactly where
   * payment timing does, which is the point of showing both.
   */
  orderRevenue: number | null;
  /** Distinct sale orders behind `orderRevenue`. */
  orderCount: number;
  operationalSales: number | null;
  operationalUntaxed: number | null;
  operationalDeals: number | null;
  quotations: number | null;
  pipeline: number | null;
  slaMonths: number;
  courseProfile: AgentCourseProfile;
  /** Published quota for this window, or `null` when none is published. */
  target: AgentTarget | null;
  performanceScore: AgentPerformanceScore;
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
  monthsCovered: string[];
  /** Months the window spans with no published target at all. */
  monthsMissing: string[];
  /** False when part of the window has no target — the ratio is then partial. */
  complete: boolean;
  /** Paid collections ÷ the whole quota, %. */
  achievementPaid: number | null;
  /** Sale orders ÷ the whole quota, %. */
  achievementOrders: number | null;
  /** Remaining amount on each basis. Negative once the quota is beaten. */
  gapPaid: number | null;
  gapOrders: number | null;
}

export interface TargetCoverage {
  /** Months that publish a quota at all. */
  publishedMonths: string[];
  /** Employees in the current selection matched to a published quota. */
  matched: number;
  /** Whole published quota across every matched employee. */
  totalTarget: number | null;
  totalPaidRevenue: number;
  /** Collections ÷ the whole quota, %. */
  totalAchievementPaid: number | null;
  /** False when the window spans a month with no published quota. */
  complete: boolean;
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

/**
 * One paid invoice behind a course figure, so the number on screen can be
 * checked against Odoo without leaving the page. Keyed by move number: a single
 * invoice can carry several lines of the same course, and they are one invoice.
 */
export interface AgentCourseInvoice {
  /** Odoo move number, for example `INVNT/2026/001819`. */
  movement: string;
  paymentDate: string;
  partner: string;
  /** Sum of every line of this course on this invoice. */
  usdPaid: number;
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

/** Leads and money rolled up over a set of courses, for the profile's totals. */
export interface AgentCourseTotals {
  courses: number;
  leads: number;
  won: number;
  lost: number;
  openLeads: number;
  paidRevenue: number;
  invoices: number;
  /** Won ÷ leads, %. `null` when the set holds no leads at all. */
  conversionRate: number | null;
  /** Won ÷ (Won + Lost), %. `null` until something has been decided. */
  decidedConversionRate: number | null;
}

export interface AgentCourseProfile {
  courses: AgentCoursePerformance[];
  specializations: AgentSpecializationPerformance[];
  bestSellingCourse: AgentCoursePerformance | null;
  leastSellingCourse: AgentCoursePerformance | null;
  bestConvertingCourse: AgentCoursePerformance | null;
  needsSupportCourse: AgentCoursePerformance | null;
  /** Every course he touched this window: the denominator behind the cards. */
  totals: AgentCourseTotals;
  /** The courses he actually sells — the only ones the two verdicts rank. */
  soldTotals: AgentCourseTotals;
  /**
   * Courses that took leads but produced no sale and no win. Reported on their
   * own rather than ranked: a rep is not "weak" at a course he was never
   * selling, but a manager still needs to see where the leads went.
   */
  unsoldTotals: AgentCourseTotals;
  /** Those same courses, largest cohort first, for the routing callout. */
  unsoldCourses: AgentCoursePerformance[];
  /**
   * Leads and money filed under a bucket that names no course — `Other` from
   * Odoo, `Uncategorized` from a blank column, `Unattributed` from a paid line
   * that is not a course. Held out of the four cards, reported under them.
   */
  nonCourseRows: AgentCoursePerformance[];
  nonCourseTotals: AgentCourseTotals;
  /** Why the strength card is empty — small cohort, or no win landed yet. */
  bestReason: BestReason;
  /** Why the weakness card is empty — small cohort, or still being worked. */
  needsSupportReason: SupportReason;
  minimumLeadSample: number;
  minimumDecidedSample: number;
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
    totalCallSeconds: number | null;
    talkSeconds: number | null;
    analyzedCalls: number | null;
    averageQualityScore: number | null;
    qualityNeedsReview: number | null;
    distributedLeads: number;
    calledDistributedLeads: number | null;
    ownerCalledDistributedLeads: number | null;
    uncalledDistributedLeads: number | null;
    callsFromDistributedLeads: number | null;
    callsByAssignedEmployee: number | null;
    leadCallCoverageRate: number | null;
    leadOwnerCallCoverageRate: number | null;
    chatConversations: number | null;
    chatResolved: number | null;
    chatUnreadConversations: number | null;
    chatUnreadMessages: number | null;
    chatAwaitingReply: number | null;
    chatAverageFirstResponseSeconds: number | null;
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
    /**
     * False when no feed exists for Odoo's operational sales report at all, as
     * opposed to a feed that simply has nothing for this window. The screen has
     * to tell those apart: one is a missing integration, the other a quiet month.
     */
    salesConfigured: boolean;
  };
  callsHub: {
    ok: boolean;
    source: string;
    fetchedAt: string;
    error?: string;
    callsAvailable: boolean;
    qualityAvailable: boolean;
    recordsAvailable: boolean;
    leadCoverageAvailable: boolean;
  };
  chatwoot: {
    ok: boolean;
    source: string;
    fetchedAt: string;
    error?: string;
    metricsAvailable: boolean;
    unassignedConversations: number | null;
  };
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export { normalizePersonName };

const monthKey = (value: string): string => value.slice(0, 7);

function cairoDateParts(): { today: string; monthStart: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  return { today, monthStart: `${values.year}-${values.month}-01` };
}

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
  return (
    rows
      .filter(hasMetric)
      .map((row) => monthKey(row.month))
      .filter(Boolean)
      .sort()
      .at(-1) || ""
  );
}

interface MutableAgent extends AgentAnalyticsRow {
  teams: Set<string>;
  firstCallWeighted: number;
  firstCallWeight: number;
  invoiceRefs: Set<string>;
  orderRefs: Set<string>;
  months: Set<string>;
  latestOpenMonth: string;
  /**
   * How many rows the operational report actually carried for this employee.
   *
   * The totals alone cannot answer it: an employee the report never mentions
   * and an employee it reports at zero both leave `operationalSales` at 0, and
   * those two mean opposite things on screen — "we have no figure for him" and
   * "he sold nothing". Only the row count separates them.
   */
  operationalRows: number;
  callsHubMatched: boolean;
  leadPhoneKeys: Set<string>;
  chatwootMatched: boolean;
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
const MINIMUM_DECIDED_SAMPLE = MIN_DECIDED_OUTCOMES;

const blankTotals = (): AgentCourseTotals => ({
  courses: 0,
  leads: 0,
  won: 0,
  lost: 0,
  openLeads: 0,
  paidRevenue: 0,
  invoices: 0,
  conversionRate: null,
  decidedConversionRate: null,
});

/** Roll a set of courses up into one row of leads, outcomes, and money. */
function totalsOf(courses: AgentCoursePerformance[]): AgentCourseTotals {
  const totals = courses.reduce((sum, course) => {
    sum.courses += 1;
    sum.leads += course.leads;
    sum.won += course.won;
    sum.lost += course.lost;
    sum.openLeads += course.openLeads;
    sum.paidRevenue += course.paidRevenue;
    sum.invoices += course.invoices;
    return sum;
  }, blankTotals());
  const decided = totals.won + totals.lost;
  totals.conversionRate = totals.leads > 0 ? (totals.won / totals.leads) * 100 : null;
  totals.decidedConversionRate = decided > 0 ? (totals.won / decided) * 100 : null;
  return totals;
}

const blankCourseProfile = (lostDataAvailable = true): AgentCourseProfile => ({
  courses: [],
  specializations: [],
  bestSellingCourse: null,
  leastSellingCourse: null,
  bestConvertingCourse: null,
  needsSupportCourse: null,
  totals: blankTotals(),
  soldTotals: blankTotals(),
  unsoldTotals: blankTotals(),
  nonCourseRows: [],
  nonCourseTotals: blankTotals(),
  unsoldCourses: [],
  bestReason: "no_book",
  needsSupportReason: "no_book",
  minimumLeadSample: MINIMUM_LEAD_SAMPLE,
  minimumDecidedSample: MINIMUM_DECIDED_SAMPLE,
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
  distributedLeads: 0,
  calledDistributedLeads: null,
  ownerCalledDistributedLeads: null,
  uncalledDistributedLeads: null,
  callsFromDistributedLeads: null,
  callsByAssignedEmployee: null,
  leadCallCoverageRate: null,
  leadOwnerCallCoverageRate: null,
  callExtension: null,
  totalCalls: null,
  outboundCalls: 0,
  answeredCalls: 0,
  answerRate: null,
  contactRate: null,
  talkSeconds: 0,
  totalCallSeconds: null,
  averageCallSeconds: null,
  analyzedCalls: null,
  averageQualityScore: null,
  qualityNeedsReview: null,
  chatConversations: null,
  chatResolved: null,
  chatUnreadConversations: null,
  chatUnreadMessages: null,
  chatAwaitingReply: null,
  chatAverageFirstResponseSeconds: null,
  chatAverageResolutionSeconds: null,
  chatAverageReplySeconds: null,
  chatwootAgentId: null,
  avgFirstCallMinutes: null,
  slaWon: 0,
  slaLost: 0,
  decidedConversionRate: null,
  orderRevenue: 0,
  orderCount: 0,
  operationalSales: 0,
  operationalUntaxed: 0,
  operationalDeals: 0,
  quotations: 0,
  pipeline: 0,
  slaMonths: 0,
  courseProfile: blankCourseProfile(),
  target: null,
  performanceScore: {
    overall: null,
    callQuality: null,
    salesExecution: null,
    chatFollowUp: null,
    targetAttainment: null,
    weights: EMPLOYEE_SCORE_WEIGHTS,
    dataCoverage: 0,
    missing: ["callQuality", "salesExecution", "chatFollowUp", "targetAttainment"],
    earnedPoints: {
      callQuality: 0,
      salesExecution: 0,
      chatFollowUp: 0,
      targetAttainment: 0,
    },
    evidence: {
      analyzedCalls: 0,
      answeredCalls: null,
      callAnalysisCoverageRate: null,
      callEvidenceFactor: 0,
      distributedLeads: 0,
      ownerCalledDistributedLeads: null,
      leadCoverageRate: null,
      leadConversionRate: null,
      normalizedConversionScore: null,
      conversionBenchmarkPercent: 20,
      chatConversations: 0,
      chatRepliedConversations: 0,
      chatAwaitingReply: 0,
      chatUnreadConversations: 0,
      targetAchievement: null,
      targetBasis: null,
      targetComplete: false,
    },
  },
  firstCallWeighted: 0,
  firstCallWeight: 0,
  invoiceRefs: new Set(),
  orderRefs: new Set(),
  months: new Set(),
  latestOpenMonth: "",
  operationalRows: 0,
  callsHubMatched: false,
  leadPhoneKeys: new Set(),
  chatwootMatched: false,
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

interface SaleDimensions {
  category: string;
  courseLabel: string;
  courseKey: string;
}

/**
 * Which course row a paid invoice line belongs to.
 *
 * Shared by the profile builder and the on-demand invoice lookup so the two
 * cannot drift: a course whose invoices the lookup could not find would show an
 * invoice count in the table beside an empty list on click.
 */
function saleDimensions(source: {
  course: string;
  mainCategory: string;
  productCategory: string;
  category: string;
}): SaleDimensions {
  const category = cleanCategoryLabel(
    source.mainCategory || source.productCategory || source.category,
  );
  const courseLabel = cleanDimensionLabel(
    source.course || source.productCategory || source.category,
  );
  return { category, courseLabel, courseKey: normalizeDimension(courseLabel) || "uncategorized" };
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
  const { category, courseLabel } = saleDimensions(source);
  const course = dimensionFor(profile.courses, courseLabel, category);
  const specialization = dimensionFor(profile.specializations, category, category);
  for (const row of [course, specialization]) {
    row.paidRevenue += source.usdPaid;
    if (source.movement && !source.isCreditNote) row.invoiceRefs.add(source.movement);
  }
}

/**
 * The invoices behind one employee's figure for one course.
 *
 * Deliberately not part of the profile payload. Shipping it there cost 551 KB
 * on a 864 KB response — every invoice of every course of all 53 employees, on
 * every page load, to serve a dialog that shows one course at a time and is
 * usually never opened. It is read here on click instead.
 */
export function courseInvoicesFor(
  data: FilteredData,
  agent: string,
  courseKey: string,
): AgentCourseInvoice[] {
  const wanted = normalizePersonName(agent);
  if (!wanted) return [];
  // Lines of one course can share a move number. They are one invoice with one
  // total, which is what the table's invoice count has always treated them as.
  const byMovement = new Map<string, AgentCourseInvoice>();
  for (const row of data.accounting) {
    if (!row.movement || row.isCreditNote) continue;
    if (normalizePersonName(row.salesperson) !== wanted) continue;
    if (saleDimensions(row).courseKey !== courseKey) continue;
    const seen = byMovement.get(row.movement);
    if (seen) seen.usdPaid += row.usdPaid;
    else
      byMovement.set(row.movement, {
        movement: row.movement,
        paymentDate: row.paymentDate,
        partner: row.partner,
        usdPaid: row.usdPaid,
      });
  }
  return [...byMovement.values()].sort(
    (left, right) =>
      right.paymentDate.localeCompare(left.paymentDate) ||
      left.movement.localeCompare(right.movement),
  );
}

function finishDimension(
  source: MutableDimension,
  totalLeads: number,
  positiveRevenue: number,
  lostDataAvailable: boolean,
): AgentCoursePerformance {
  const decided = source.won + source.lost;
  const mainCategory =
    [...source.categoryWeight.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ||
    source.mainCategory;
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
      lostDataAvailable && source.leads >= MINIMUM_LEAD_SAMPLE && decided >= MINIMUM_DECIDED_SAMPLE
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
  // An archived row still marked Won is a deal he won and then filed away, so
  // it is a win here. Calling it "open" left it in his lead count forever
  // without ever crediting the close, which is how a course could show two paid
  // invoices beside zero wins.
  const archivedWin = archivedWinFilter(data.crm);
  for (const lead of data.lost) {
    const id = lead.id || `${lead.salesperson}|${lead.createdAt}|${lead.contact}`;
    if (seenArchived.has(id)) continue;
    seenArchived.add(id);
    if (archivedWin(lead)) addLeadToProfile(mutable, lead, "won");
    else if (!isArchivedWonStage(lead.stage)) addLeadToProfile(mutable, lead, "lost");
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
          right.paidRevenue - left.paidRevenue ||
          right.leads - left.leads ||
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
          right.leads - left.leads ||
          right.paidRevenue - left.paidRevenue ||
          left.label.localeCompare(right.label),
      );

    // One population behind all four summary cards. `courses` is already sorted
    // by revenue, so the head of the book is the best seller.
    //
    // `Other` and the other non-course buckets are held out of the ranking
    // entirely: a card naming one of them tells a manager to coach an employee
    // on the absence of a subject. They keep their row in the table and their
    // weight in the totals, and are reported on their own line instead.
    const rankableCourses = courses.filter(isCoachableCourse);
    const nonCourseRows = courses.filter((row) => !isCoachableCourse(row));
    const sellingCourses = rankableCourses.filter(isSoldCourse);
    const unsoldCourses = rankableCourses
      .filter((row) => !isSoldCourse(row))
      .sort((left, right) => right.leads - left.leads || left.label.localeCompare(right.label));
    const bestSellingCourse = sellingCourses[0] ?? null;
    const leastSellingCourse =
      sellingCourses.length > 1
        ? [...sellingCourses].sort(
            (left, right) => left.paidRevenue - right.paidRevenue || left.invoices - right.invoices,
          )[0]
        : null;
    const {
      best: bestConvertingCourse,
      needsSupport: needsSupportCourse,
      bestReason,
      needsSupportReason,
    } = rankCourseInsights(rankableCourses);

    profiles.set(personKey, {
      courses,
      specializations,
      bestSellingCourse,
      leastSellingCourse,
      bestConvertingCourse,
      needsSupportCourse,
      totals: totalsOf(courses),
      soldTotals: totalsOf(sellingCourses),
      unsoldTotals: totalsOf(unsoldCourses),
      unsoldCourses,
      nonCourseRows,
      nonCourseTotals: totalsOf(nonCourseRows),
      bestReason,
      needsSupportReason,
      minimumLeadSample: MINIMUM_LEAD_SAMPLE,
      minimumDecidedSample: MINIMUM_DECIDED_SAMPLE,
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

/**
 * Sale orders per salesperson, from the `invoiced` dataset Odoo already feeds.
 *
 * This used to come from the SLA project's `sales_summary` view, which no
 * longer runs. The order lines carry the same fact — a confirmed sale on a
 * named rep — and are already synced every few minutes, so the second basis is
 * computed here rather than waiting on a pipeline that has no source left.
 */
function mergeOrderRevenue(map: Map<string, MutableAgent>, data: FilteredData) {
  for (const order of data.invoiced) {
    if (!order.salesperson) continue;
    const key = normalizePersonName(order.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, order.salesperson);
    row.orderRevenue = (row.orderRevenue ?? 0) + order.usdSales;
    if (order.orderRef) row.orderRefs.add(order.orderRef);
    if (order.salesTeam) row.teams.add(order.salesTeam);
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

/**
 * The Calls Hub owns the call facts. The legacy SLA feed remains useful for
 * CRM timing, but its monthly call totals must never be added to the live PBX
 * totals or the employee would be counted twice.
 */
function mergeCallsHubEmployees(
  map: Map<string, MutableAgent>,
  employees: CallsHubEmployeeSummary[],
) {
  for (const source of employees) {
    const exactKey = normalizePersonName(source.name);
    if (!exactKey) continue;
    const exact = map.get(exactKey);
    const candidates = exact
      ? []
      : [...map.entries()]
          .map(([candidateKey, candidate]) => ({
            candidateKey,
            candidate,
            score: integrationPersonMatchScore(candidate.name, source.name),
          }))
          .filter((candidate) => candidate.score > 0);
    const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
    const best = candidates.filter((candidate) => candidate.score === bestScore);
    // A short PBX name is attached only when it points to one employee. When
    // two Odoo people could match, retaining a separate PBX row is safer than
    // crediting calls to the wrong person.
    const matched = exact
      ? ([exactKey, exact] as const)
      : best.length === 1
        ? ([best[0].candidateKey, best[0].candidate] as const)
        : null;
    const key = matched?.[0] ?? exactKey;
    const row = matched?.[1] ?? blank(key, source.name);
    row.callExtension = source.extension;
    row.totalCalls = source.totalCalls;
    // Kept for response compatibility; the UI labels this as all PBX calls.
    row.outboundCalls = source.totalCalls;
    row.answeredCalls = source.answeredCalls;
    row.totalCallSeconds = source.periodCallSeconds;
    row.talkSeconds = source.periodTalkSeconds;
    row.averageCallSeconds = source.averageCallSeconds;
    row.analyzedCalls = source.analyzedCalls;
    row.averageQualityScore = source.averageScore;
    row.qualityNeedsReview = source.needsReview;
    row.callsHubMatched = true;
    map.set(key, row);
  }
}

function mergeChatwootAgents(map: Map<string, MutableAgent>, agents: ChatwootAgentMetric[]) {
  for (const source of agents) {
    const exactKey = normalizePersonName(source.name);
    if (!exactKey) continue;
    const exact = map.get(exactKey);
    const candidates = exact
      ? []
      : [...map.entries()]
          .map(([candidateKey, candidate]) => ({
            candidateKey,
            candidate,
            score: integrationPersonMatchScore(candidate.name, source.name),
          }))
          .filter((candidate) => candidate.score > 0);
    const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
    const best = candidates.filter((candidate) => candidate.score === bestScore);
    const matched = exact
      ? ([exactKey, exact] as const)
      : best.length === 1
        ? ([best[0].candidateKey, best[0].candidate] as const)
        : null;
    const key = matched?.[0] ?? exactKey;
    const row = matched?.[1] ?? blank(key, source.name);
    row.chatConversations = source.conversations;
    row.chatResolved = source.resolved;
    row.chatUnreadConversations = source.unreadConversations;
    row.chatUnreadMessages = source.unreadMessages;
    row.chatAwaitingReply = source.awaitingReply;
    row.chatAverageFirstResponseSeconds = source.averageFirstResponseSeconds;
    row.chatAverageResolutionSeconds = source.averageResolutionSeconds;
    row.chatAverageReplySeconds = source.averageReplySeconds;
    row.chatwootAgentId = source.id;
    row.chatwootMatched = true;
    map.set(key, row);
  }
}

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

function phoneKey(value: string): string {
  const digits = value
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/\D/g, "");
  // Yeastar may hold +9665..., Odoo may hold 05..., and Egyptian records can
  // similarly carry a country prefix. The subscriber's final nine digits are
  // stable across those formats. Short extensions are never considered.
  return digits.length >= 9 ? digits.slice(-9) : "";
}

function mergeLeadCallCoverage(
  map: Map<string, MutableAgent>,
  data: FilteredData,
  calls: CallsHubLeadCallAggregate[],
) {
  const callsByPhone = new Map<string, CallsHubLeadCallAggregate[]>();
  for (const call of calls) {
    const key = phoneKey(call.phone);
    if (!key) continue;
    const rows = callsByPhone.get(key) ?? [];
    rows.push(call);
    callsByPhone.set(key, rows);
  }
  for (const row of map.values()) {
    row.distributedLeads = 0;
    row.calledDistributedLeads = 0;
    row.ownerCalledDistributedLeads = 0;
    row.uncalledDistributedLeads = 0;
    row.callsFromDistributedLeads = 0;
    row.callsByAssignedEmployee = 0;
    row.leadPhoneKeys.clear();
  }

  const leads = new Map<
    string,
    { id: string; salesperson: string; phone: string; mobile: string; createdAt: string }
  >();
  for (const lead of [...data.crm, ...data.lost]) {
    if (!lead.id || !lead.salesperson) continue;
    leads.set(lead.id, lead);
  }
  for (const lead of leads.values()) {
    const key = normalizePersonName(lead.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, lead.salesperson);
    row.distributedLeads += 1;
    const matches = new Map<string, CallsHubLeadCallAggregate>();
    const leadPhoneKeys = new Set([lead.phone, lead.mobile].map(phoneKey).filter(Boolean));
    for (const phone of leadPhoneKeys) {
      for (const call of callsByPhone.get(phone) ?? []) {
        if (!callCanCoverLead(call, lead.createdAt)) continue;
        matches.set(leadCallAggregateKey(call), call);
      }
    }
    if (!matches.size) {
      row.uncalledDistributedLeads = (row.uncalledDistributedLeads ?? 0) + 1;
      map.set(key, row);
      continue;
    }
    row.calledDistributedLeads = (row.calledDistributedLeads ?? 0) + 1;
    let calledByOwner = false;
    for (const call of matches.values()) {
      const sameOwner =
        normalizePersonName(call.agentName) === key ||
        (row.callExtension && call.agentExtension === row.callExtension);
      // Coverage is lead-grain: if two Odoo opportunities share a customer
      // phone, each has still been reached by its assigned owner. Call totals,
      // however, stay de-duplicated below so the same PBX call is not summed
      // twice. The old order performed the de-duplication first and therefore
      // under-counted owner coverage on the second opportunity.
      if (sameOwner) calledByOwner = true;
      const matchedCallKey = leadCallAggregateKey(call);
      if (row.leadPhoneKeys.has(matchedCallKey)) continue;
      row.leadPhoneKeys.add(matchedCallKey);
      row.callsFromDistributedLeads = (row.callsFromDistributedLeads ?? 0) + call.totalCalls;
      if (sameOwner) {
        row.callsByAssignedEmployee = (row.callsByAssignedEmployee ?? 0) + call.totalCalls;
      }
    }
    if (calledByOwner) {
      row.ownerCalledDistributedLeads = (row.ownerCalledDistributedLeads ?? 0) + 1;
    }
    map.set(key, row);
  }

  for (const row of map.values()) {
    row.leadCallCoverageRate =
      row.distributedLeads > 0
        ? ((row.calledDistributedLeads ?? 0) / row.distributedLeads) * 100
        : null;
    row.leadOwnerCallCoverageRate =
      row.distributedLeads > 0
        ? ((row.ownerCalledDistributedLeads ?? 0) / row.distributedLeads) * 100
        : null;
  }
}

function mergeSlaSales(map: Map<string, MutableAgent>, rows: SlaSalesSummary[]) {
  for (const source of rows) {
    const key = normalizePersonName(source.user_name || "");
    if (!key) continue;
    const row = map.get(key) ?? blank(key, source.user_name || "—");
    if (source.team_name) row.teams.add(source.team_name);
    row.months.add(monthKey(source.month));
    row.operationalRows += 1;
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
    if (filters.channel === "organic" && !isOrganicSourceKey(row.sourceKey)) return false;
    if (filters.platform && !platformCampaigns?.has(row.campaignKey)) return false;
    if (filters.campaign && row.campaignName !== filters.campaign) return false;
    if (filters.campaignKey && row.campaignKey !== filters.campaignKey) return false;
    if (sourceKey && row.sourceKey !== sourceKey) return false;
    if (filters.course && row.course !== filters.course) return false;
    if (filters.mainCategory && row.mainCategory !== filters.mainCategory) return false;
    if (!normalizedEquals(row.salesperson, filters.salesperson)) return false;
    return true;
  };

  const countedWonIds = new Set<string>();
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
    if (lead.id) countedWonIds.add(lead.id);
    map.set(key, row);
  }

  // The archive is not a synonym for Lost. A deal won in Odoo gets archived
  // like any other closed record and keeps `stage = Won`; counting the whole
  // archive as losses booked his own wins against him and pulled the period
  // closure rate down with them.
  for (const lead of data.snapshot.lost) {
    if (!dateIncluded(lead.closeDate, filters) || !commonMatch(lead)) continue;
    if (filters.salesTeam && !normalizedEquals(lead.salesTeam, filters.salesTeam)) continue;
    const key = normalizePersonName(lead.salesperson);
    if (!key) continue;
    const won = isArchivedWonStage(lead.stage);
    if (won && lead.id && countedWonIds.has(lead.id)) continue;
    const row = map.get(key) ?? blank(key, lead.salesperson);
    if (lead.salesTeam) row.teams.add(lead.salesTeam);
    if (won) row.slaWon += 1;
    else row.slaLost += 1;
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
  source: TargetSource,
): TargetCoverage {
  const { byName, duplicates } = targetsByPerson(source);
  const publishedMonths = targetMonths(source);

  const matchedEmployeeIds = new Set<string>();
  for (const row of agents) {
    const person = byName.get(normalizePersonName(row.name));
    if (!person) continue;
    const resolved = windowTarget(person.monthly, filters.from, filters.to);
    const { target } = resolved;
    // Achievement always divides by the whole published quota, never by a
    // day-scaled slice of it.
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
      monthsCovered: resolved.monthsCovered,
      monthsMissing: resolved.monthsMissing,
      complete: resolved.complete,
      achievementPaid: share(row.paidRevenue),
      achievementOrders: share(row.orderRevenue),
      gapPaid: gap(row.paidRevenue),
      gapOrders: gap(row.orderRevenue),
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
  const totalPaidRevenue = targeted.reduce((sum, row) => sum + row.paidRevenue, 0);

  return {
    publishedMonths,
    matched: matchedEmployeeIds.size,
    totalTarget,
    totalPaidRevenue,
    totalAchievementPaid:
      totalTarget !== null && totalTarget > 0 ? (totalPaidRevenue / totalTarget) * 100 : null,
    complete: targeted.every((row) => row.target?.complete ?? false),
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
  mergeOrderRevenue(map, data);
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
    salesConfigured: false,
  };
  let callsHubStatus: AgentAnalyticsResult["callsHub"] = {
    ok: false,
    source: "Engosoft Calls Hub · Yeastar",
    fetchedAt: "",
    callsAvailable: false,
    qualityAvailable: false,
    recordsAvailable: false,
    leadCoverageAvailable: false,
  };
  let chatwootStatus: AgentAnalyticsResult["chatwoot"] = {
    ok: false,
    source: "Chatwoot · Agent reports",
    fetchedAt: "",
    metricsAvailable: false,
    unassignedConversations: null,
  };
  const fallbackRange = cairoDateParts();
  const integrationFrom = filters.from || fallbackRange.monthStart;
  const integrationTo = filters.to || fallbackRange.today;
  // Start independent network reads together. The old implementation waited
  // for the SLA store before even contacting the PBX, which made the employee
  // page pay every upstream latency one after another.
  const callsSnapshotPromise = getCallsHubSummary(integrationFrom, integrationTo);
  const leadCallsPromise = getCallsHubLeadCalls(integrationFrom, integrationTo).catch(() => null);
  const chatwootPromise = chatwootConfigured()
    ? getChatwootAgentSnapshot(integrationFrom, integrationTo)
    : Promise.resolve(null);
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
      salesConfigured: snapshot.salesSummaryConfigured,
    };
  } catch (error) {
    slaStatus.error = error instanceof Error ? error.message : String(error);
  }

  try {
    const callsSnapshot = await callsSnapshotPromise;
    mergeCallsHubEmployees(map, callsSnapshot.employees);
    let leadCoverageAvailable = false;
    const leadCalls = await leadCallsPromise;
    if (leadCalls) {
      mergeLeadCallCoverage(map, data, leadCalls);
      leadCoverageAvailable = true;
    }
    const totalCalls = callsSnapshot.employees.reduce((sum, row) => sum + row.totalCalls, 0);
    const analyzedCalls = callsSnapshot.employees.reduce((sum, row) => sum + row.analyzedCalls, 0);
    callsHubStatus = {
      ok: true,
      source: callsSnapshot.source,
      fetchedAt: callsSnapshot.fetchedAt,
      callsAvailable: callsSnapshot.employees.length > 0,
      qualityAvailable: analyzedCalls > 0,
      recordsAvailable: totalCalls > 0,
      leadCoverageAvailable,
    };
    // Preserve the old response field for existing consumers while migrating
    // its call side to the canonical Calls Hub source.
    slaStatus.callsAvailable = callsHubStatus.callsAvailable;
    slaStatus.callsThrough = callsSnapshot.range.to;
  } catch (error) {
    callsHubStatus.error = error instanceof Error ? error.message : String(error);
  }

  try {
    // Chatwoot's conversation activity walks paginated inbox results. On a
    // cold Railway process that can take tens of seconds; employee accounting
    // must not stay blank while a secondary source warms. The original promise
    // keeps running and fills its one-minute cache for the next request.
    const chatSnapshot = await Promise.race([
      chatwootPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    if (!chatSnapshot) throw new Error("Chatwoot analytics are not configured");
    mergeChatwootAgents(map, chatSnapshot.agents);
    chatwootStatus = {
      ok: true,
      source: chatSnapshot.source,
      fetchedAt: chatSnapshot.fetchedAt,
      metricsAvailable: chatSnapshot.agents.some((row) => row.conversations > 0),
      unassignedConversations: chatSnapshot.unassignedConversations,
    };
  } catch (error) {
    chatwootStatus.error = error instanceof Error ? error.message : String(error);
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
    if (!callsHubStatus.ok) {
      slaStatus.callsAvailable = selectedAgents.some(
        (row) =>
          num(row.outboundCalls) > 0 || num(row.answeredCalls) > 0 || num(row.talkSeconds) > 0,
      );
    }
    // Row count, not value. Testing for a non-zero total was the only signal
    // available while the report had no feed, but it reads a real reported zero
    // as "no data" — which now matters, because a zero month is a fact about
    // the employee and blanking it hides a miss behind an em dash.
    slaStatus.salesAvailable = selectedAgents.some((row) => row.operationalRows > 0);
  }

  const agents = selectedAgents
    .map((row): AgentAnalyticsRow => {
      row.invoices = row.invoiceRefs.size;
      row.orderCount = row.orderRefs.size;
      row.team = [...row.teams].filter(Boolean).join(" · ") || "—";
      row.conversionRate = row.cleanLeads > 0 ? (row.won / row.cleanLeads) * 100 : null;
      row.lostRate = row.cleanLeads > 0 ? (row.lost / row.cleanLeads) * 100 : null;
      row.answerRate =
        (row.outboundCalls ?? 0) > 0
          ? ((row.answeredCalls ?? 0) / (row.outboundCalls ?? 1)) * 100
          : null;
      row.contactRate = row.newLeads > 0 ? (row.contactedLeads / row.newLeads) * 100 : null;
      row.decidedConversionRate =
        row.slaWon + row.slaLost > 0 ? (row.slaWon / (row.slaWon + row.slaLost)) * 100 : null;
      row.avgFirstCallMinutes =
        row.firstCallWeight > 0 ? row.firstCallWeighted / row.firstCallWeight : null;
      row.slaMonths = row.months.size;
      row.courseProfile =
        courseProfiles.get(row.key) ??
        blankCourseProfile(data.snapshot.health.lostAuthority !== "unavailable");
      if (callsHubStatus.ok && !row.callsHubMatched) {
        row.callExtension = null;
        row.totalCalls = null;
        row.outboundCalls = null;
        row.answeredCalls = null;
        row.talkSeconds = null;
        row.totalCallSeconds = null;
        row.averageCallSeconds = null;
        row.analyzedCalls = null;
        row.averageQualityScore = null;
        row.qualityNeedsReview = null;
      } else if (!slaStatus.callsAvailable) {
        row.totalCalls = null;
        row.outboundCalls = null;
        row.answeredCalls = null;
        row.talkSeconds = null;
      }
      // Per employee, not per selection: the report can cover the team and
      // still not mention this person, and his card must say so rather than
      // borrow a colleague's coverage to imply he sold nothing.
      if (!slaStatus.salesAvailable || row.operationalRows === 0) {
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
        (row.analyzedCalls ?? 0) > 0 ||
        (row.chatConversations ?? 0) > 0 ||
        (row.operationalSales ?? 0) !== 0 ||
        (row.operationalDeals ?? 0) > 0,
    )
    .sort((a, b) => b.paidRevenue - a.paidRevenue || b.cleanLeads - a.cleanLeads);

  // Attach the quota before calculating the composite. Previously the score
  // was finalised first, so target attainment could not participate at all.
  // The source is the seed with any saved edits applied; a store that cannot be
  // read falls back to the seed rather than reporting everyone as untargeted.
  const { source: targetSource } = await loadTargetSource();
  const targets = buildTargetCoverage(agents, [...map.values()], filters, targetSource);

  for (const row of agents) {
    row.performanceScore = calculateEmployeePerformanceScore({
      averageQualityScore: row.averageQualityScore,
      analyzedCalls: row.analyzedCalls,
      answeredCalls: row.answeredCalls,
      distributedLeads: row.distributedLeads,
      ownerCalledDistributedLeads: row.ownerCalledDistributedLeads,
      leadOwnerCallCoverageRate: row.leadOwnerCallCoverageRate,
      cleanLeads: row.cleanLeads,
      conversionRate: row.conversionRate,
      chatConversations: row.chatConversations,
      chatAwaitingReply: row.chatAwaitingReply,
      chatUnreadConversations: row.chatUnreadConversations,
      targetAchievementOrders: row.target?.achievementOrders ?? null,
      targetAchievementPaid: row.target?.achievementPaid ?? null,
      targetComplete: row.target?.complete ?? false,
    });
  }

  const summary = agents.reduce(
    (acc, row) => {
      acc.paidRevenue += row.paidRevenue;
      acc.invoices += row.invoices;
      acc.cleanLeads += row.cleanLeads;
      acc.won += row.won;
      acc.lost += row.lost;
      acc.periodClosedWon += row.slaWon;
      acc.periodClosedLost += row.slaLost;
      if (row.outboundCalls !== null)
        acc.outboundCalls = (acc.outboundCalls ?? 0) + row.outboundCalls;
      if (row.answeredCalls !== null)
        acc.answeredCalls = (acc.answeredCalls ?? 0) + row.answeredCalls;
      if (row.totalCallSeconds !== null)
        acc.totalCallSeconds = (acc.totalCallSeconds ?? 0) + row.totalCallSeconds;
      if (row.talkSeconds !== null) acc.talkSeconds = (acc.talkSeconds ?? 0) + row.talkSeconds;
      if (row.analyzedCalls !== null)
        acc.analyzedCalls = (acc.analyzedCalls ?? 0) + row.analyzedCalls;
      if (row.qualityNeedsReview !== null)
        acc.qualityNeedsReview = (acc.qualityNeedsReview ?? 0) + row.qualityNeedsReview;
      acc.distributedLeads += row.distributedLeads;
      if (row.calledDistributedLeads !== null)
        acc.calledDistributedLeads = (acc.calledDistributedLeads ?? 0) + row.calledDistributedLeads;
      if (row.ownerCalledDistributedLeads !== null)
        acc.ownerCalledDistributedLeads =
          (acc.ownerCalledDistributedLeads ?? 0) + row.ownerCalledDistributedLeads;
      if (row.uncalledDistributedLeads !== null)
        acc.uncalledDistributedLeads =
          (acc.uncalledDistributedLeads ?? 0) + row.uncalledDistributedLeads;
      if (row.callsFromDistributedLeads !== null)
        acc.callsFromDistributedLeads =
          (acc.callsFromDistributedLeads ?? 0) + row.callsFromDistributedLeads;
      if (row.callsByAssignedEmployee !== null)
        acc.callsByAssignedEmployee =
          (acc.callsByAssignedEmployee ?? 0) + row.callsByAssignedEmployee;
      if (row.chatConversations !== null)
        acc.chatConversations = (acc.chatConversations ?? 0) + row.chatConversations;
      if (row.chatResolved !== null) acc.chatResolved = (acc.chatResolved ?? 0) + row.chatResolved;
      if (row.chatUnreadConversations !== null)
        acc.chatUnreadConversations =
          (acc.chatUnreadConversations ?? 0) + row.chatUnreadConversations;
      if (row.chatUnreadMessages !== null)
        acc.chatUnreadMessages = (acc.chatUnreadMessages ?? 0) + row.chatUnreadMessages;
      if (row.chatAwaitingReply !== null)
        acc.chatAwaitingReply = (acc.chatAwaitingReply ?? 0) + row.chatAwaitingReply;
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
      totalCallSeconds: slaStatus.callsAvailable ? 0 : (null as number | null),
      talkSeconds: slaStatus.callsAvailable ? 0 : (null as number | null),
      analyzedCalls: callsHubStatus.ok ? 0 : (null as number | null),
      averageQualityScore: null as number | null,
      qualityNeedsReview: callsHubStatus.ok ? 0 : (null as number | null),
      distributedLeads: 0,
      calledDistributedLeads: callsHubStatus.leadCoverageAvailable ? 0 : (null as number | null),
      ownerCalledDistributedLeads: callsHubStatus.leadCoverageAvailable
        ? 0
        : (null as number | null),
      uncalledDistributedLeads: callsHubStatus.leadCoverageAvailable ? 0 : (null as number | null),
      callsFromDistributedLeads: callsHubStatus.leadCoverageAvailable ? 0 : (null as number | null),
      callsByAssignedEmployee: callsHubStatus.leadCoverageAvailable ? 0 : (null as number | null),
      leadCallCoverageRate: null as number | null,
      leadOwnerCallCoverageRate: null as number | null,
      chatConversations: chatwootStatus.ok ? 0 : (null as number | null),
      chatResolved: chatwootStatus.ok ? 0 : (null as number | null),
      chatUnreadConversations: chatwootStatus.ok ? 0 : (null as number | null),
      chatUnreadMessages: chatwootStatus.ok ? 0 : (null as number | null),
      chatAwaitingReply: chatwootStatus.ok ? 0 : (null as number | null),
      chatAverageFirstResponseSeconds: null as number | null,
    },
  );
  summary.conversionRate = summary.cleanLeads > 0 ? (summary.won / summary.cleanLeads) * 100 : null;
  summary.decidedConversionRate =
    summary.periodClosedWon + summary.periodClosedLost > 0
      ? (summary.periodClosedWon / (summary.periodClosedWon + summary.periodClosedLost)) * 100
      : null;
  summary.answerRate =
    (summary.outboundCalls ?? 0) > 0
      ? ((summary.answeredCalls ?? 0) / (summary.outboundCalls ?? 1)) * 100
      : null;
  const scoredEmployees = agents.filter(
    (row) => row.averageQualityScore !== null && (row.analyzedCalls ?? 0) > 0,
  );
  const scoredCalls = scoredEmployees.reduce((sum, row) => sum + (row.analyzedCalls ?? 0), 0);
  summary.averageQualityScore =
    scoredCalls > 0
      ? scoredEmployees.reduce(
          (sum, row) => sum + (row.averageQualityScore ?? 0) * (row.analyzedCalls ?? 0),
          0,
        ) / scoredCalls
      : null;
  summary.leadCallCoverageRate =
    summary.distributedLeads > 0 && summary.calledDistributedLeads !== null
      ? (summary.calledDistributedLeads / summary.distributedLeads) * 100
      : null;
  summary.leadOwnerCallCoverageRate =
    summary.distributedLeads > 0 && summary.ownerCalledDistributedLeads !== null
      ? (summary.ownerCalledDistributedLeads / summary.distributedLeads) * 100
      : null;
  const chatRows = agents.filter(
    (row) => row.chatAverageFirstResponseSeconds !== null && (row.chatConversations ?? 0) > 0,
  );
  const chatWeight = chatRows.reduce((sum, row) => sum + (row.chatConversations ?? 0), 0);
  summary.chatAverageFirstResponseSeconds =
    chatWeight > 0
      ? chatRows.reduce(
          (sum, row) =>
            sum + (row.chatAverageFirstResponseSeconds ?? 0) * (row.chatConversations ?? 0),
          0,
        ) / chatWeight
      : null;

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
    callsHub: callsHubStatus,
    chatwoot: chatwootStatus,
  };
}
