import { canonicalCourseValue, normalizeCourseKey } from "./course-taxonomy";
import { countsAsPotentialLead } from "./lead-count-policy";
import {
  classifyDailyCourse,
  dailyBaseCourse,
  dailyReportCourse,
  interiorCampaignLookup,
  INTERIOR_REPORT_COURSES,
} from "./daily-interior-split";

export interface DailyEntry {
  id: string;
  course: string;
  createdAt: string;
  status: string;
  recordType: string;
  source: string;
  segment: string;
  name: string;
  url: string;
  campaign: string;
  campaignKey?: string;
  reportCourse?: string;
}
export interface DailyLoss {
  campaign?: string;
  campaignKey?: string;
  reportCourse?: string;
  id: string;
  course: string;
  date: string;
  recordType: string;
  name: string;
  url: string;
  source: string;
  segment: string;
}
export interface DailyPayment {
  campaign?: string;
  campaignKey?: string;
  reportCourse?: string;
  course: string;
  order: string;
  company: string;
  leadId: string;
  date: string;
  amount: number;
  invoice: string;
}
export interface DailySpend {
  reportCourse?: string;
  course: string;
  campaign: string;
  campaignKey: string;
  platform: string;
  date: string;
  spend: number;
  attribution: string;
}
export interface DailyAvailability {
  crm: boolean;
  lost: boolean;
  revenue: boolean;
  links: boolean;
  daySpend: boolean;
  monthSpend: boolean;
}
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const dailyCourse = (course: string) =>
  Object.values(INTERIOR_REPORT_COURSES).some(
    (label) => normalizeCourseKey(label) === normalizeCourseKey(course),
  )
    ? course.trim()
    : canonicalCourseValue(course) || course.trim() || "Unclassified";
export const dailyCourseKey = (course: string) => normalizeCourseKey(dailyCourse(course));
export const dailyReportingKey = (row: { course: string; reportCourse?: string }) =>
  dailyCourseKey(dailyReportCourse(row));
export function validDailyDate(value: string, today: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value &&
    value <= today &&
    value >= "2025-01-01"
  );
}

/** Creation cohorts, observed Lost movement and payment-date revenue stay disjoint. */
export function buildDailyUpdates(input: {
  day: string;
  entries: DailyEntry[];
  losses: DailyLoss[];
  payments: DailyPayment[];
  spend: DailySpend[];
  courses?: string[];
  availability: DailyAvailability;
}) {
  const { day, availability } = input;
  const monthFrom = day.slice(0, 7) + "-01";
  const lookup = interiorCampaignLookup(input.spend);
  const entries = [
    ...new Map(
      input.entries
        .filter(
          (r) =>
            r.id &&
            r.createdAt >= monthFrom &&
            r.createdAt <= day &&
            countsAsPotentialLead(r.source, r.segment),
        )
        .map((r) => [r.id, classifyDailyCourse(r, lookup)]),
    ).values(),
  ];
  const losses = [
    ...new Map(
      input.losses
        .filter((r) => r.id && r.date === day && countsAsPotentialLead(r.source, r.segment))
        .map((r) => [r.id, classifyDailyCourse(r, lookup)]),
    ).values(),
  ];
  const payments = input.payments
    .filter((p) => p.date >= monthFrom && p.date <= day)
    .map((p) => classifyDailyCourse(p, lookup));
  const spend = input.spend.map((p) => classifyDailyCourse(p, lookup));
  // Order references are company-scoped; conflicting opportunity links are rejected upstream.
  const netOrders = new Map<string, number>();
  for (const p of payments)
    if (p.order && p.leadId) {
      const key = p.company + "\0" + p.order + "\0" + p.leadId + "\0" + dailyCourseKey(p.course);
      netOrders.set(key, (netOrders.get(key) || 0) + p.amount);
    }
  const paidCourses = new Map<string, Set<string>>();
  for (const p of payments) {
    const net =
      netOrders.get(
        p.company + "\0" + p.order + "\0" + p.leadId + "\0" + dailyCourseKey(p.course),
      ) || 0;
    if (net <= 0 || p.amount <= 0 || !p.leadId) continue;
    const courses = paidCourses.get(p.leadId) || new Set<string>();
    courses.add(dailyCourseKey(p.course));
    paidCourses.set(p.leadId, courses);
  }
  const courseNames = new Map<string, string>();
  for (const r of [...entries, ...losses, ...payments, ...spend]) {
    courseNames.set(dailyReportingKey(r), dailyReportCourse(r));
  }
  for (const course of input.courses || []) {
    if (dailyBaseCourse(course) === "Interior") {
      for (const mode of ["online", "offline"] as const)
        courseNames.set(
          dailyCourseKey(INTERIOR_REPORT_COURSES[mode]),
          INTERIOR_REPORT_COURSES[mode],
        );
    } else courseNames.set(dailyCourseKey(course), dailyCourse(course));
  }
  const summarize = (course?: string) => {
    const same = (r: { course: string; reportCourse?: string }) =>
      course === undefined || dailyReportingKey(r) === course;
    const monthEntries = entries.filter(same);
    const dayEntries = monthEntries.filter((r) => r.createdAt === day);
    const dayLosses = losses.filter(same);
    const paid = payments.filter(same);
    const adRows = spend.filter((r) => same(r) && r.date >= monthFrom && r.date <= day);
    const dayPaid = paid.filter((p) => p.date === day);
    const converted = monthEntries.filter((r) =>
      paidCourses.get(r.id)?.has(dailyCourseKey(r.course)),
    );
    const dayConverted = dayEntries.filter((r) =>
      paidCourses.get(r.id)?.has(dailyCourseKey(r.course)),
    );
    const revenueDay = dayPaid.reduce((s, p) => s + p.amount, 0);
    const revenueMonth = paid.reduce((s, p) => s + p.amount, 0);
    const spendDay = adRows.filter((r) => r.date === day).reduce((s, r) => s + r.spend, 0);
    const spendMonth = adRows.reduce((s, r) => s + r.spend, 0);
    const cohortLost = dayEntries.filter((r) => r.status === "lost");
    const monthCohortLost = monthEntries.filter((r) => r.status === "lost");
    const dayWon = dayEntries.filter((r) => r.status === "won");
    const monthWon = monthEntries.filter((r) => r.status === "won");
    return {
      leadsDay: availability.crm ? dayEntries.length : null,
      leadsMonth: availability.crm ? monthEntries.length : null,
      cplDay: availability.crm && availability.daySpend ? ratio(spendDay, dayEntries.length) : null,
      cplMonth:
        availability.crm && availability.monthSpend ? ratio(spendMonth, monthEntries.length) : null,
      wonDay: availability.crm ? dayWon.length : null,
      wonMonth: availability.crm ? monthWon.length : null,
      closureRateDay: availability.crm
        ? ratio(dayWon.length, dayWon.length + cohortLost.length)
        : null,
      closureRateMonth: availability.crm
        ? ratio(monthWon.length, monthWon.length + monthCohortLost.length)
        : null,
      lostDay: availability.lost ? dayLosses.length : null,
      lostLeadsDay: availability.lost
        ? dayLosses.filter((r) => r.recordType === "lead").length
        : null,
      lostOpportunitiesDay: availability.lost
        ? dayLosses.filter((r) => r.recordType === "opportunity").length
        : null,
      cohortLostDay: availability.crm ? cohortLost.length : null,
      cohortLostMonth: availability.crm ? monthCohortLost.length : null,
      cohortLostRate: availability.crm ? ratio(cohortLost.length, dayEntries.length) : null,
      cohortLostRateMonth: availability.crm
        ? ratio(monthCohortLost.length, monthEntries.length)
        : null,
      paidDayCohort:
        availability.crm && availability.links && availability.revenue ? dayConverted.length : null,
      paidMonthCohort:
        availability.crm && availability.links && availability.revenue ? converted.length : null,
      conversionDay:
        availability.crm && availability.links && availability.revenue
          ? ratio(dayConverted.length, dayEntries.length)
          : null,
      conversionMonth:
        availability.crm && availability.links && availability.revenue
          ? ratio(converted.length, monthEntries.length)
          : null,
      revenueDay: availability.revenue ? revenueDay : null,
      revenueMonth: availability.revenue ? revenueMonth : null,
      spendDay: availability.daySpend ? spendDay : null,
      spendMonth: availability.monthSpend ? spendMonth : null,
      roasDay: availability.daySpend && availability.revenue ? ratio(revenueDay, spendDay) : null,
      roasMonth:
        availability.monthSpend && availability.revenue ? ratio(revenueMonth, spendMonth) : null,
      invoicesDay: availability.revenue
        ? new Set(dayPaid.filter((p) => p.amount > 0).map((p) => p.company + "\0" + p.invoice)).size
        : null,
    };
  };
  const rows = [...courseNames]
    .map(([key, course]) => {
      const adRows = spend.filter(
        (r) => dailyReportingKey(r) === key && r.date >= monthFrom && r.date <= day,
      );
      const campaigns = [...new Set(adRows.map((r) => r.campaignKey))]
        .map((campaignKey) => {
          const parts = adRows.filter((r) => r.campaignKey === campaignKey);
          const name = parts[0]?.campaign || campaignKey;
          const matchingNames = new Set(
            adRows.filter((r) => r.campaign === name).map((r) => r.campaignKey),
          );
          const leads = entries.filter(
            (r) =>
              dailyReportingKey(r) === key &&
              (r.campaignKey
                ? r.campaignKey === campaignKey
                : matchingNames.size === 1 && r.campaign === name),
          );
          return {
            key: campaignKey,
            name,
            platforms: [...new Set(parts.map((r) => r.platform))],
            spendDay: availability.daySpend
              ? parts.filter((r) => r.date === day).reduce((s, r) => s + r.spend, 0)
              : null,
            spendMonth: availability.monthSpend ? parts.reduce((s, r) => s + r.spend, 0) : null,
            leadsDay: availability.crm ? leads.filter((r) => r.createdAt === day).length : null,
            attribution: [...new Set(parts.map((r) => r.attribution))],
          };
        })
        .sort(
          (a, b) =>
            (b.spendDay ?? 0) - (a.spendDay ?? 0) || (b.spendMonth ?? 0) - (a.spendMonth ?? 0),
        );
      return { key, course, baseCourse: dailyBaseCourse(course), ...summarize(key), campaigns };
    })
    .sort(
      (a, b) =>
        (b.leadsDay ?? 0) - (a.leadsDay ?? 0) ||
        (b.revenueMonth ?? 0) - (a.revenueMonth ?? 0) ||
        a.course.localeCompare(b.course),
    );
  return {
    day,
    monthFrom,
    rows,
    totals: summarize(),
    availability,
    details: {
      leads: entries,
      lost: losses,
      paid: entries.filter((r) => paidCourses.get(r.id)?.has(dailyCourseKey(r.course))),
      invoices: payments.map(({ leadId, order, ...p }) => p),
    },
  };
}
export type DailyUpdatesData = ReturnType<typeof buildDailyUpdates>;
