import { describe, expect, it } from "vitest";
import { buildDailyUpdates, dailyCourseKey, dailyReportingKey } from "@/lib/daily-updates";
import {
  classifyDailyCourse,
  interiorCampaignDelivery,
  interiorCampaignLookup,
  INTERIOR_REPORT_COURSES as labels,
} from "@/lib/daily-interior-split";

const day = "2026-11-26";
const names = [
  "INTERIOR-19/11/26-sayed-saudi-test-off",
  "INTERIOR-4/11/26- sayed-off",
  "INTERIOR-3/11/26- sayed",
];
export function interiorFixture() {
  return buildDailyUpdates({
    day,
    availability: {
      crm: true,
      lost: true,
      revenue: true,
      links: true,
      daySpend: true,
      monthSpend: true,
    },
    courses: ["Interior"],
    entries: [...names, ""].map((campaign, i) => ({
      id: String(i + 1),
      course: "Interior",
      campaign,
      campaignKey: i < 3 ? `id:${i}` : undefined,
      createdAt: day,
      status: i === 0 ? "won" : i === 1 ? "lost" : "open",
      recordType: "opportunity",
      source: "Facebook",
      segment: "Fresh",
      name: `Customer ${i + 1}`,
      url: `https://example.test/${i + 1}`,
    })),
    losses: names.map((campaign, i) => ({
      id: String(i + 1),
      course: "Interior",
      campaign,
      date: day,
      recordType: "opportunity",
      source: "Facebook",
      segment: "Fresh",
      name: `Customer ${i + 1}`,
      url: "",
    })),
    payments: [...names, ""].map((campaign, i) => ({
      course: "Interior",
      campaign,
      order: `S${i}`,
      company: "KSA",
      leadId: String(i + 1),
      date: day,
      amount: (i + 1) * 100,
      invoice: `INV${i}`,
    })),
    spend: names.map((campaign, i) => ({
      course: "Interior",
      campaign,
      campaignKey: `id:${i}`,
      platform: "meta",
      date: day,
      spend: (i + 1) * 10,
      attribution: "campaign_name",
    })),
  });
}
describe("Interior delivery split", () => {
  it("uses the owner's exact classification and does not treat offer/office as off", () => {
    expect(names.map(interiorCampaignDelivery)).toEqual(["offline", "offline", "online"]);
    expect(interiorCampaignDelivery(" INTERIOR_OFF_SAYED-14/10/26 ")).toBe("offline");
    expect(interiorCampaignDelivery("Interior - offline - test")).toBe("offline");
    expect(interiorCampaignDelivery("Interior-offer-office")).toBe("online");
    expect(interiorCampaignDelivery("CFM-off")).toBe("unattributed");
    expect(interiorCampaignDelivery("")).toBe("unattributed");
  });
  it("resolves ID-only records without guessing ambiguous campaigns", () => {
    const lookup = interiorCampaignLookup([
      { course: "Interior", campaign: names[0], campaignKey: "id:1" },
    ]);
    expect(
      classifyDailyCourse({ course: "Interior", campaignKey: "id:1" }, lookup).reportCourse,
    ).toBe(labels.offline);
    expect(
      classifyDailyCourse({ course: "Interior", campaignKey: "id:missing" }, lookup).reportCourse,
    ).toBe(labels.unattributed);
    const conflict = interiorCampaignLookup(
      names.slice(1).map((campaign) => ({ course: "Interior", campaignKey: "same", campaign })),
    );
    expect(
      classifyDailyCourse({ course: "Interior", campaignKey: "same" }, conflict).reportCourse,
    ).toBe(labels.unattributed);
    expect(classifyDailyCourse({ course: "CFM", campaign: "CFM-off" }, lookup).reportCourse).toBe(
      "CFM",
    );
  });
  it("partitions every metric and detail without collapsing the keys or duplicating totals", () => {
    const report = interiorFixture();
    expect(report.rows).toHaveLength(3);
    expect(new Set(report.rows.map((r) => r.key)).size).toBe(3);
    expect(report.rows.every((r) => r.baseCourse === "Interior")).toBe(true);
    const offline = report.rows.find((r) => r.course === labels.offline)!;
    expect(offline).toMatchObject({
      leadsDay: 2,
      leadsMonth: 2,
      spendDay: 30,
      revenueDay: 300,
      paidDayCohort: 2,
      conversionDay: 1,
      cohortLostDay: 1,
      lostDay: 2,
      wonDay: 1,
    });
    expect(offline.campaigns.map((c) => c.name).sort()).toEqual(names.slice(0, 2).sort());
    const unknown = report.rows.find((r) => r.course === labels.unattributed)!;
    expect(unknown).toMatchObject({ leadsDay: 1, revenueDay: 400, spendDay: 0 });
    for (const field of [
      "leadsDay",
      "leadsMonth",
      "spendDay",
      "spendMonth",
      "revenueDay",
      "revenueMonth",
      "lostDay",
      "cohortLostDay",
      "paidDayCohort",
      "wonDay",
    ] as const)
      expect(report.rows.reduce((s, r) => s + (r[field] || 0), 0)).toBeCloseTo(
        report.totals[field]!,
      );
    expect(
      report.details.leads.filter((r) => dailyReportingKey(r) === offline.key).map((r) => r.id),
    ).toEqual(["1", "2"]);
    expect(dailyCourseKey(labels.offline)).not.toBe(dailyCourseKey("Interior"));
    expect(report.details.leads.every((r) => r.course === "Interior")).toBe(true);
  });
});
