import { analyzeCourseLeadFacts, type CourseDailyFact } from "./course-lead-alerts";
import { UNATTRIBUTED_COURSE } from "./course-taxonomy";
import type { GlobalFilters } from "./types";

const DAY_MS = 86_400_000;

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

function cairoDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dayDistance(from: string, to: string): number {
  const delta = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(delta) ? Math.max(0, Math.floor(delta / DAY_MS)) : 0;
}

function latest(values: string[]): string {
  return values.filter(Boolean).sort().pop() ?? "";
}

/** Only operational dimensions apply; a historical date picker must not hide today's alert. */
function operationalFilters(filters: GlobalFilters): GlobalFilters {
  const {
    platform,
    channel,
    account,
    campaign,
    campaignKey,
    adset,
    adsetKey,
    ad,
    adKey,
    source,
    course,
    mainCategory,
    salesTeam,
    salesperson,
    includeNonLead,
  } = filters;
  return {
    platform,
    channel,
    account,
    campaign,
    campaignKey,
    adset,
    adsetKey,
    ad,
    adKey,
    source,
    course,
    mainCategory,
    salesTeam,
    salesperson,
    includeNonLead,
    range: "all",
  };
}

export async function buildCurrentCourseLeadAlertReport(filters: GlobalFilters = {}) {
  const { archivedCrmLeads, archivedLostReportingDate, attributedAdCourse, getFiltered } =
    await import("./metrics.server");
  const data = await getFiltered(operationalFilters(filters));
  const yesterday = shiftDay(cairoDay(), -1);
  const archived = archivedCrmLeads(data);
  const adMax = latest(data.ads.map((row) => row.date));
  const leadMax = latest([
    ...data.crm.map((row) => row.createdAt),
    ...archived.map((row) => archivedLostReportingDate(row, data.snapshot)),
  ]);
  const sourceMaxima =
    filters.channel === "organic"
      ? [yesterday, leadMax]
      : adMax && leadMax
        ? [yesterday, adMax, leadMax]
        : [yesterday, adMax || leadMax];
  const anchorDate = sourceMaxima.filter(Boolean).sort()[0] ?? yesterday;
  const freshnessAgeDays = dayDistance(anchorDate, yesterday);
  const suppressAlerts = !anchorDate || freshnessAgeDays > 2;
  const freshnessMessage = suppressAlerts
    ? `تم إيقاف الإنذارات لأن آخر يوم مشترك مكتمل هو ${anchorDate || "غير متاح"}، أقدم من آخر يوم مكتمل بـ${freshnessAgeDays} يوم.`
    : "الإنذارات مبنية على آخر يوم مكتمل في الإعلانات وCRM.";
  const facts: CourseDailyFact[] = [];
  const nonCourseBuckets = new Set(["other", "uncategorized", "unattributed"]);
  const validCourse = (course: string) =>
    course &&
    /[\p{L}\p{N}]/u.test(course) &&
    course !== UNATTRIBUTED_COURSE &&
    !nonCourseBuckets.has(course.trim().toLocaleLowerCase("en"));

  for (const row of data.ads) {
    if (!row.date) continue;
    const course = attributedAdCourse(row, data.snapshot).course;
    if (!validCourse(course)) continue;
    facts.push({ date: row.date, course, leads: 0, spend: row.spend });
  }
  for (const row of data.crm) {
    if (!row.createdAt || !validCourse(row.course)) continue;
    facts.push({ date: row.createdAt, course: row.course, leads: 1, spend: 0 });
  }
  for (const row of archived) {
    const date = archivedLostReportingDate(row, data.snapshot);
    if (!date || !validCourse(row.course)) continue;
    facts.push({ date, course: row.course, leads: 1, spend: 0 });
  }

  return analyzeCourseLeadFacts(facts, {
    anchorDate,
    generatedAt: new Date().toISOString(),
    baselineWeeks: 8,
    trendDays: 28,
    freshnessAgeDays,
    freshnessMessage,
    suppressAlerts,
  });
}
