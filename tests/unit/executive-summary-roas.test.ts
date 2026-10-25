import { describe, expect, it } from "vitest";
import { execSummary } from "@/lib/metrics.server";
import type { DataHealth } from "@/lib/metrics.server";
import { overviewResponse, totals } from "../component/fixtures/overview-response";

const health = {
  platformsWithoutSpendTab: [],
  leadsWithoutSpendSource: 0,
  unpricedSources: [],
} as unknown as DataHealth;

describe("executive summary return labels", () => {
  it("uses campaign-attributed revenue for advertising ROAS", () => {
    const summary = execSummary(totals(), [], {}, { from: "2026-08-01", to: "2026-08-09" }, health);

    expect(summary.ar).toContain("العائد الإعلاني المنسوب 2.55×");
    expect(summary.ar).toContain("كل التحصيل ÷ صرف الإعلانات 8.51×");
    expect(summary.ar).toContain("مش ROAS إعلاني");
    expect(summary.ar).not.toContain("العائد الأساسي");

    expect(summary.en).toContain("attributed ad ROAS of 2.55×");
    expect(summary.en).toContain("All collected revenue ÷ ad spend is 8.51×");
    expect(summary.en).toContain("not advertising ROAS");
    expect(summary.en).not.toContain("primary ROAS");
  });

  it("says every figure of the English summary in at most four plain Arabic lines", () => {
    const fixtureRows = overviewResponse().activity.rows;
    // One lead campaign that clears the cheapest-CPL bar, so that branch runs.
    const rows = [
      ...fixtureRows,
      {
        ...fixtureRows[0],
        key: "cheap-leads",
        name: "Automotive - Riyadh - 4/7/26 - CBO - sh",
        spend: 122,
        platformLeads: 139,
        cpl: 0.88,
        objective: "leads",
        partialSpend: false,
      },
    ];
    const fullHealth = {
      platformsWithoutSpendTab: [
        { platform: "tiktok", leads: 2045 },
        { platform: "google", leads: 4 },
      ],
      leadsWithoutSpendSource: 165,
      unpricedSources: [{ label: "WhatsApp Broadcast" }, { label: "Website" }],
    } as unknown as DataHealth;
    const summary = execSummary(
      { ...totals(), nonLeadSpend: 380.9, lostArchived: 12 },
      rows,
      { spend: -23 },
      { from: "2026-08-01", to: "2026-08-11" },
      fullHealth,
    );

    // Every optional branch is on, so nothing is compared against an absence.
    expect(summary.en).toContain("Best campaign");
    expect(summary.en).toContain("Biggest leak");
    expect(summary.en).toContain("Cheapest platform-reported leads");
    expect(summary.en).toContain("Deals take");

    const figures = (text: string) => new Set(text.match(/[$]?\d[\d,]*(?:\.\d+)?[%×]?/g) ?? []);
    const missing = [...figures(summary.en)].filter((figure) => !figures(summary.ar).has(figure));
    expect(missing).toEqual([]);
    expect(summary.ar.split("\n").length).toBeLessThanOrEqual(4);
    // Plain Egyptian, not the formal wording it replaced.
    expect(summary.ar).not.toContain("سكان الـCRM");
    expect(summary.ar).toContain("جالنا");
  });
});
