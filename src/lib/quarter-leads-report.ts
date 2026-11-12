import { countsAsPotentialLead } from "./lead-count-policy";
import { PLATFORM_SOURCE_KEYS } from "./acquisition-channel";
import { canonicalCourseValue } from "./course-taxonomy";
import { isWebsiteCampaignName, isWebinarCampaignName } from "./campaign-purpose";
export const REVIEW_MONTHS = ["2026-08", "2026-09", "2026-10"] as const;
export function leadSpendExclusion(row: {
  campaign: string;
  account: string;
  objective: string;
}): string | null {
  if (
    isWebsiteCampaignName(row.campaign) ||
    /website|web\s*site/i.test(row.campaign + " " + row.account)
  )
    return "website";
  if (isWebinarCampaignName(row.campaign)) return "webinar";
  if (
    /(?:^|[^a-z])(traffic|engagement|branding|brand awareness|awareness|reach|video views?|social media|profile|followers?|page likes)(?:[^a-z]|$)/i.test(
      row.campaign,
    )
  )
    return "social_awareness";
  if (row.objective !== "leads") return "non_lead_or_unknown";
  return null;
}
export interface ReviewAd {
  month: string;
  course: string;
  platform: string;
  campaign: string;
  campaignKey: string;
  account: string;
  objective: string;
  spend: number;
  clicks: number;
  nativeLeads: number | null;
}
export interface ReviewLead {
  id: string;
  createdAt: string;
  course: string;
  platform: string;
  campaign: string;
  campaignKey: string;
  source: string;
  segment: string;
  status: string;
  recordType: string;
  closeDate: string;
  dateBasis: string;
  nativeEvidence: boolean;
}
export interface ReviewPayment {
  company: string;
  invoice: string;
  order: string;
  leadId: string;
  date: string;
  course: string;
  amount: number;
}
export function platformForReview(source: string): string {
  const key = source.trim().toLowerCase();
  return (
    Object.entries(PLATFORM_SOURCE_KEYS).find(([, keys]) => keys.includes(key))?.[0] || "unknown"
  );
}
const course = (s: string) => canonicalCourseValue(s) || s.trim() || "Unclassified";
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function buildQuarterLeadReview(input: {
  ads: ReviewAd[];
  leads: ReviewLead[];
  payments: ReviewPayment[];
  asOf: string;
  spendCoverage: Record<string, boolean>;
  crmReady: boolean;
  revenueReady: boolean;
  linksReady: boolean;
}) {
  const eligibleAds = input.ads.filter(
    (a) => REVIEW_MONTHS.includes(a.month as any) && !leadSpendExclusion(a),
  );
  const excluded = input.ads.filter(
    (a) => REVIEW_MONTHS.includes(a.month as any) && leadSpendExclusion(a),
  );
  const excludedLeadCounts = { nonPlatform: 0, sourcePolicy: 0, websiteOrSocial: 0 };
  const byKey = new Map<string, ReviewAd[]>(),
    byName = new Map<string, ReviewAd[]>();
  for (const a of input.ads) {
    const key = a.platform + "\0" + a.campaignKey,
      name = a.platform + "\0" + a.campaign;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(a);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(a);
  }
  const leadMap = new Map<string, ReviewLead>();
  for (const l of input.leads) {
    if (!l.id || leadMap.has(l.id) || !REVIEW_MONTHS.includes(l.createdAt.slice(0, 7) as any))
      continue;
    if (!countsAsPotentialLead(l.source, l.segment)) {
      excludedLeadCounts.sourcePolicy++;
      continue;
    }
    if (l.platform === "unknown") {
      excludedLeadCounts.nonPlatform++;
      continue;
    }
    const ads =
      (l.campaignKey
        ? byKey.get(l.platform + "\0" + l.campaignKey)
        : l.campaign
          ? byName.get(l.platform + "\0" + l.campaign)
          : []) || [];
    if (
      (ads.length && ads.every(leadSpendExclusion)) ||
      (!ads.length &&
        leadSpendExclusion({
          campaign: l.campaign,
          account: "CRM paid source",
          objective: "leads",
        }))
    ) {
      excludedLeadCounts.websiteOrSocial++;
      continue;
    }
    leadMap.set(l.id, { ...l, course: course(l.course) });
  }
  const leads = [...leadMap.values()];
  const payments = input.payments.filter((p) => p.date <= input.asOf);
  const paid = new Map<string, number>(),
    positiveOrders = new Map<string, number>();
  let linkedRevenue = 0,
    unlinkedRevenue = 0,
    courseMismatchRevenue = 0,
    otherCohortRevenue = 0,
    beforeEntryRevenue = 0;
  for (const p of payments) {
    const l = leadMap.get(p.leadId);
    if (!l) {
      if (p.leadId) otherCohortRevenue += p.amount;
      else unlinkedRevenue += p.amount;
      continue;
    }
    if (course(p.course) !== l.course) {
      courseMismatchRevenue += p.amount;
      continue;
    }
    if (p.date < l.createdAt) {
      beforeEntryRevenue += p.amount;
      continue;
    }
    linkedRevenue += p.amount;
    paid.set(l.id, (paid.get(l.id) || 0) + p.amount);
    const key = l.id + "\0" + p.company + "\0" + p.order;
    if (p.order) positiveOrders.set(key, (positiveOrders.get(key) || 0) + p.amount);
  }
  const paidIds = new Set(
    [...positiveOrders].filter(([, net]) => net > 0).map(([key]) => key.split("\0")[0]),
  );
  function summarize(month: string, selectedCourse?: string, platform?: string) {
    const a = eligibleAds.filter(
      (a) =>
        a.month === month &&
        (!selectedCourse || course(a.course) === selectedCourse) &&
        (!platform || a.platform === platform),
    );
    const l = leads.filter(
      (l) =>
        l.createdAt.startsWith(month) &&
        (!selectedCourse || l.course === selectedCourse) &&
        (!platform || l.platform === platform),
    );
    const nativeKnown = a.reduce((s, a) => s + (a.nativeLeads || 0), 0);
    const nativeComplete = a.every((a) => a.nativeLeads !== null);
    const spendKnown = a.reduce((s, a) => s + a.spend, 0);
    const spendReady = Boolean(input.spendCoverage[month]);
    const won = l.filter((l) => l.status === "won"),
      lost = l.filter((l) => l.status === "lost");
    const dated = l
      .filter((l) => ["won", "lost"].includes(l.status))
      .map((l) => ({
        l,
        days: (Date.parse(l.closeDate) - Date.parse(l.createdAt)) / 86400000,
      }))
      .filter((x) => Number.isFinite(x.days) && x.days >= 0 && x.l.closeDate <= input.asOf);
    const durations = dated.map((x) => x.days);
    const cohortRevenue = l.reduce((s, l) => s + (paid.get(l.id) || 0), 0);
    const r = {
      month,
      course: selectedCourse || "All courses",
      platform: platform || "all",
      spend: spendReady ? spendKnown : null,
      spendKnown,
      nativeLeads: spendReady && nativeComplete ? nativeKnown : null,
      nativeKnown,
      nativeComplete,
      nativeCpl: spendReady && nativeComplete ? ratio(spendKnown, nativeKnown) : null,
      clicks: a.reduce((s, a) => s + a.clicks, 0),
      cpc: spendReady
        ? ratio(
            spendKnown,
            a.reduce((s, a) => s + a.clicks, 0),
          )
        : null,
      crmLeads: input.crmReady ? l.length : null,
      won: input.crmReady ? won.length : null,
      lost: input.crmReady ? lost.length : null,
      lostLeads: input.crmReady ? lost.filter((l) => l.recordType === "lead").length : null,
      lostOpportunities: input.crmReady
        ? lost.filter((l) => l.recordType === "opportunity").length
        : null,
      open: input.crmReady ? l.length - won.length - lost.length : null,
      wonRate: input.crmReady ? ratio(won.length, l.length) : null,
      lostRate: input.crmReady ? ratio(lost.length, l.length) : null,
      paidLeads:
        input.crmReady && input.linksReady && input.revenueReady
          ? l.filter((l) => paidIds.has(l.id)).length
          : null,
      cohortRevenue:
        input.crmReady && input.linksReady && input.revenueReady ? cohortRevenue : null,
      cohortRoas:
        input.crmReady && input.linksReady && input.revenueReady && spendReady
          ? ratio(cohortRevenue, spendKnown)
          : null,
      nativeProvenCrm: input.crmReady ? l.filter((l) => l.nativeEvidence).length : null,
      cycleMean: input.crmReady ? avg(durations) : null,
      cycleMedian: input.crmReady ? median(durations) : null,
      wonCycle: input.crmReady
        ? avg(dated.filter((x) => x.l.status === "won").map((x) => x.days))
        : null,
      lostCycle: input.crmReady
        ? avg(dated.filter((x) => x.l.status === "lost").map((x) => x.days))
        : null,
      datedClosures: input.crmReady ? dated.length : null,
      undatedClosures: input.crmReady ? won.length + lost.length - dated.length : null,
      proxyDates: input.crmReady
        ? dated.filter(
            (x) => !["won_date", "date_closed", "lost_verification_date"].includes(x.l.dateBasis),
          ).length
        : null,
      lifecycle: [7, 30, 60, 90, Infinity].map((max, i, all) => ({
        bucket: ["0–7", "8–30", "31–60", "61–90", "90+"][i],
        count: input.crmReady
          ? dated.filter(
              (x) =>
                x.days <= (max === Infinity ? Infinity : max) && (i === 0 || x.days > all[i - 1]),
            ).length
          : null,
      })),
    };
    return r;
  }
  const months = REVIEW_MONTHS.map((m) => ({
    ...summarize(m),
    excludedSpend: excluded.filter((a) => a.month === m).reduce((s, a) => s + a.spend, 0),
  }));
  const courses = [
    ...new Set([...eligibleAds.map((a) => course(a.course)), ...leads.map((l) => l.course)]),
  ].sort();
  const byCourse = REVIEW_MONTHS.flatMap((m) => courses.map((c) => summarize(m, c)));
  const platforms = [
    ...new Set([...eligibleAds.map((a) => a.platform), ...leads.map((l) => l.platform)]),
  ].sort();
  const byPlatform = REVIEW_MONTHS.flatMap((m) => platforms.map((p) => summarize(m, undefined, p)));
  const comparison = REVIEW_MONTHS.flatMap((m) =>
    courses.flatMap((c) => platforms.map((p) => summarize(m, c, p))),
  ).filter((r) => (r.crmLeads || 0) > 0 || r.spendKnown > 0);
  const audit = new Map<string, ReviewAd & { exclusion: string | null }>();
  for (const a of input.ads) {
    const exclusion = leadSpendExclusion(a),
      key = [a.month, a.platform, a.campaignKey, a.course, exclusion].join("\0");
    const prior = audit.get(key);
    if (!prior) audit.set(key, { ...a, exclusion });
    else {
      prior.spend += a.spend;
      prior.clicks += a.clicks;
      prior.nativeLeads =
        prior.nativeLeads === null || a.nativeLeads === null
          ? null
          : prior.nativeLeads + a.nativeLeads;
    }
  }
  return {
    months,
    byCourse,
    byPlatform,
    comparison,
    campaignAudit: [...audit.values()],
    coverage: {
      ...excludedLeadCounts,
      cohortIds: leads.length,
      linkedRevenue,
      unlinkedRevenue,
      otherCohortRevenue,
      courseMismatchRevenue,
      beforeEntryRevenue,
      unlinkedInvoices: new Set(
        payments.filter((p) => !p.leadId).map((p) => p.company + "\0" + p.invoice),
      ).size,
      nativeProvenCrm: leads.filter((l) => l.nativeEvidence).length,
    },
    definitions: {
      fresh: "creation_month_cohort",
      won: "current_state_as_of_read",
      roas: "exact_opportunity_link_cohort_revenue_to_as_of_divided_by_creation_month_spend",
    },
  };
}
export type QuarterLeadReview = ReturnType<typeof buildQuarterLeadReview>;
