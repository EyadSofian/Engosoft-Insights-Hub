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
    expect(result.lifecycle.observedMaxDays).toBe(9);
    expect(result.lifecycle.buckets).toEqual([
      { label: "0", count: 0 },
      { label: "1", count: 0 },
      { label: "2–3", count: 1 },
      { label: "4–7", count: 0 },
      { label: "8–14", count: 1 },
    ]);
    expect(result.lifecycle.won).toEqual({ count: 1, averageDays: 9 });
    expect(result.lifecycle.lost).toEqual({ count: 1, averageDays: 2 });
    expect(result.totals.won).toBe(1);
    expect(result.totals.lost).toBe(1);
    expect(result.campaigns[0].course).toBe("SFM");
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

  it("breaks each course into Odoo sources and then campaigns without changing the card total", () => {
    const withSources = {
      ...data,
      crm: [
        {
          ...data.crm[0],
          source: "Facebook",
          campaignName: "CFM launch",
          campaignKey: "id:launch",
        },
        {
          ...data.crm[1],
          source: "facebook",
          campaignName: "CFM launch",
          campaignKey: "id:launch",
        },
        { ...data.crm[1], id: "4", source: "Instagram", campaignName: "", campaignKey: "" },
      ],
      lost: [
        {
          ...data.lost[0],
          source: "Facebook",
          campaignName: "CFM retarget",
          campaignKey: "id:retarget",
        },
      ],
    } as unknown as FilteredData;
    const result = buildLeadIntelligence(withSources, { "2026-10": plan });
    const course = result.courses[0];
    expect(course.leads).toBe(4);
    expect(course.sources.map(({ source, leads }) => [source, leads])).toEqual([
      ["Facebook", 3],
      ["Instagram", 1],
    ]);
    expect(course.sources.reduce((sum, source) => sum + source.leads, 0)).toBe(course.leads);
    expect(course.sources[0].share).toBe(0.75);
    expect(
      course.sources[0].campaigns.map(({ name, leads, won, lost }) => [name, leads, won, lost]),
    ).toEqual([
      ["CFM launch", 2, 1, 0],
      ["CFM retarget", 1, 0, 1],
    ]);
    expect(course.sources[1].campaigns[0].name).toBe("");
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

  it("uses longer lifecycle bands when the selected creation cohort includes older closures", () => {
    const older = {
      ...data,
      lost: [
        ...data.lost,
        {
          ...data.lost[0],
          id: "4",
          createdAt: "2026-08-01",
          closeDate: "2026-09-15",
        },
      ],
      applied: { from: "2026-08-01", to: "2026-10-10" },
    } as FilteredData;
    const result = buildLeadIntelligence(older, { "2026-10": plan });
    expect(result.lifecycle.observedMaxDays).toBe(45);
    expect(result.lifecycle.buckets).toEqual([
      { label: "0–7", count: 1 },
      { label: "8–30", count: 1 },
      { label: "31–60", count: 1 },
      { label: "61–90", count: 0 },
      { label: "91–180", count: 0 },
      { label: "181+", count: 0 },
    ]);
  });

  it("tracks first and second 30-day outcomes from the same creation cohort", () => {
    const cohort = {
      ...data,
      crm: [
        { ...data.crm[0], createdAt: "2026-01-01", closedAt: "2026-01-10" },
        { ...data.crm[1], createdAt: "2026-01-01" },
      ],
      lost: [
        {
          ...data.lost[0],
          createdAt: "2026-01-01",
          closeDate: "2026-02-10",
          lossReason: "Not Interested",
        },
        {
          ...data.lost[0],
          id: "4",
          createdAt: "2026-01-01",
          closeDate: "2026-03-10",
          lossReason: "غير مهتم",
        },
      ],
      applied: { from: "2026-01-01", to: "2026-01-31" },
    } as FilteredData;
    const result = buildLeadIntelligence(cohort, {}, "SFM", "", 1, "", cohort, "2026-04-01");
    const entry = result.cohorts.courses[0];
    expect(entry.total).toBe(4);
    expect(entry.current).toMatchObject({ won: 1, lost: 2, open: 1, wonRate: 0.25, lostRate: 0.5 });
    expect(entry.month1).toMatchObject({
      eligible: 4,
      won: 1,
      lost: 0,
      open: 3,
      additionalWon: 0,
      additionalLost: 0,
    });
    expect(entry.month2).toMatchObject({
      eligible: 4,
      won: 1,
      lost: 1,
      open: 2,
      additionalWon: 0,
      additionalLost: 1,
      lostRate: 0.25,
    });
    expect(entry.history.find((row) => row.month === "2026-01")).toMatchObject({
      leads: 4,
      mature60: 4,
      lost60: 1,
      lostRate60: 0.25,
    });
    expect(entry.reasons).toHaveLength(1);
    expect(entry.reasons[0]).toMatchObject({
      canonicalReasonKey: "not_interested",
      count: 2,
      share: 100,
    });
  });

  it("marks immature cohorts and undated closures instead of inventing a final rate", () => {
    const incomplete = {
      ...data,
      crm: [{ ...data.crm[0], createdAt: "2026-10-01", closedAt: "2026-10-10" }],
      lost: [{ ...data.lost[0], createdAt: "2026-10-01", closeDate: "", lostDate: "" }],
      applied: { from: "2026-10-01", to: "2026-10-20" },
    } as FilteredData;
    const result = buildLeadIntelligence(
      incomplete,
      {},
      "SFM",
      "",
      1,
      "",
      incomplete,
      "2026-10-20",
    );
    const entry = result.cohorts.courses[0];
    expect(entry.month1).toMatchObject({
      eligible: 0,
      wonRate: null,
      lostRate: null,
      observedWon: 1,
    });
    expect(entry.month2).toMatchObject({ eligible: 0, wonRate: null, lostRate: null });
    expect(entry.history.at(-1)).toMatchObject({ leads: 2, mature60: 0, lostRate60: null });
  });

  it("marks Lost metrics unavailable when the canonical Odoo Lost source is down", () => {
    const unavailable = {
      ...data,
      lost: [],
      snapshot: { health: { lostAuthority: "unavailable" } },
    } as unknown as FilteredData;
    const result = buildLeadIntelligence(unavailable, { "2026-10": plan });
    expect(result.lostAvailable).toBe(false);
    expect(result.cohorts.courses[0].current.lost).toBe(0);
  });
});
