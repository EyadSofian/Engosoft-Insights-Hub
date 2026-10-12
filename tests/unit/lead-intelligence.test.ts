import { describe, expect, it } from "vitest";
import { buildLeadIntelligence } from "@/lib/lead-intelligence.server";
import type { FilteredData } from "@/lib/metrics.server";
import type { MonthlyMediaPlan } from "@/lib/media-plan";

const plan = {
  month: "2026-10",
  status: "approved",
  leadTarget: 100,
  paidLeadTarget: 100,
  organicWebinarLeadTarget: 0,
  leadGenerationBudgetUsd: 1000,
  salesTargetUsd: 2000,
  courses: [{ key: "sfm", label: "SFM", targetLeads: 100, targetCpl: 10, owners: [] }],
  additionalActivities: [],
} satisfies MonthlyMediaPlan;

const data = {
  crm: [
    {
      id: "1",
      course: "SFM",
      salesperson: "Ali",
      campaignName: "SFM Q4",
      campaignKey: "id:1",
      createdAt: "2026-10-01",
      closedAt: "2026-10-10",
      wonDate: "",
      daysToClose: 9,
      isWon: true,
    },
    {
      id: "2",
      course: "SFM",
      salesperson: "Ali",
      campaignName: "SFM Q4",
      campaignKey: "id:1",
      createdAt: "2026-10-02",
      closedAt: "",
      wonDate: "",
      daysToClose: null,
      isWon: false,
    },
  ],
  lost: [
    {
      id: "3",
      course: "SFM",
      salesperson: "Mona",
      campaignName: "SFM Q4",
      campaignKey: "id:1",
      createdAt: "2026-10-03",
      closeDate: "2026-10-05",
      lostDate: "",
    },
  ],
  ads: [],
  invoiced: [],
  accounting: [
    {
      course: "SFM",
      salesperson: "Ali",
      partner: "Customer A",
      usdPaid: 200,
      campaignKey: "id:1",
      campaignName: "SFM Q4",
    },
  ],
  applied: { from: "2026-10-01", to: "2026-10-10" },
  snapshot: {},
} as unknown as FilteredData;

describe("course lead intelligence", () => {
  it("prorates approved targets and includes zero-lead days", () => {
    const result = buildLeadIntelligence(data, { "2026-10": plan });
    expect(result.courses[0].target).toBe(100);
    expect(result.courses[0].expectedLeads).toBeCloseTo(1000 / 31);
    expect(result.courses[0].leads).toBe(3);
    expect(result.daily).toHaveLength(10);
    expect(result.daily[3].leads).toBe(0);
    expect(result.daily[3].target).toBeCloseTo(100 / 31);
    expect(result.lifecycle.sample).toBe(2);
    expect(result.lifecycle.averageDays).toBe(5.5);
    expect(result.totals.won).toBe(1);
    expect(result.totals.lost).toBe(1);
  });

  it("does not assign ad spend or course targets to a salesperson", () => {
    const result = buildLeadIntelligence(data, { "2026-10": plan }, "SFM", "Ali");
    expect(result.totals.leads).toBe(2);
    expect(result.totals.revenue).toBe(200);
    expect(result.totals.spend).toBeNull();
    expect(result.totals.roas).toBeNull();
    expect(result.courses[0].target).toBeNull();
    expect(result.campaigns[0].spend).toBeNull();
  });

  it("uses all-time paid revenue for the observed customer value proxy", () => {
    const history = {
      ...data,
      accounting: [
        ...data.accounting,
        { course: "SFM", salesperson: "Ali", partner: "Customer A", usdPaid: 100 },
      ],
    } as FilteredData;
    const result = buildLeadIntelligence(data, { "2026-10": plan }, "SFM", "Ali", 1, "", history);
    expect(result.totals.revenue).toBe(200);
    expect(result.totals.observedLtv).toBe(300);
  });

  it("shows no target when the period has no approved plan", () => {
    const result = buildLeadIntelligence(data, {});
    expect(result.courses[0].target).toBeNull();
    expect(result.daily[0].target).toBeNull();
  });

  it("shows draft plan targets as provisional and compares progress with elapsed days", () => {
    const draft = { ...plan, status: "draft" as const };
    const result = buildLeadIntelligence(data, { "2026-10": draft });
    expect(result.courses[0].target).toBe(100);
    expect(result.courses[0].targetCoverage).toBe("draft_plan_prorated_by_calendar_day");
    expect(result.courses[0].achievement).toBeCloseTo(3 / (1000 / 31));
    expect(result.daily[0].target).toBeCloseTo(100 / 31);
  });

  it("uses only campaign-linked collections for ad ROAS", () => {
    const withAds = {
      ...data,
      ads: [{ campaign: "SFM Q4", campaignKey: "id:1", courseHint: "SFM", spend: 100 }],
      accounting: [
        ...data.accounting,
        {
          course: "SFM",
          salesperson: "Ali",
          partner: "Customer B",
          usdPaid: 900,
          campaignKey: "",
          campaignName: "",
        },
      ],
      snapshot: { campaigns: new Map() },
    } as unknown as FilteredData;
    const result = buildLeadIntelligence(withAds, { "2026-10": plan });
    expect(result.totals.revenue).toBe(1100);
    expect(result.totals.attributedRevenue).toBe(200);
    expect(result.totals.roas).toBe(2);
    expect(result.totals.roi).toBe(1);
  });
});
