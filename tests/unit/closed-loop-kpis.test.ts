import { describe, expect, it } from "vitest";
import { emptyMetrics, finalizeMetrics, type QualityMetrics } from "@/lib/closed-loop";
import { cheapVersusQuality, closedLoopKpis, type KpiInputs } from "@/lib/closed-loop-kpis";

const metrics = (overrides: Partial<QualityMetrics>): QualityMetrics =>
  finalizeMetrics({ ...emptyMetrics(), ...overrides });

// Production figures for 2026-01-01 → 2026-09-14.
const production = (): KpiInputs => ({
  all: metrics({
    leads: 15_894,
    crmMatched: 15_297,
    won: 725,
    revenue: 264_367.15,
    spend: 87_779.99,
  }),
  tracked: metrics({
    leads: 15_161,
    crmMatched: 15_161,
    interested: 2_760,
    qualified: 1_797,
    quotations: 1_018,
    won: 722,
    revenue: 263_699.52,
    spend: 80_698.79,
  }),
  totalSpend: 87_779.99,
  trackedSpend: 80_698.79,
  spendSynced: true,
  crmSynced: true,
});

describe("ROAS never mixes populations under one generic label", () => {
  it("states the all-spend ROAS as tracked revenue over ALL spend (≈3.00x)", () => {
    const kpi = closedLoopKpis(production()).roasAllSpend!;
    expect(kpi.value).toBe(3);
    expect(kpi.numerator!.value).toBe(263_699.52);
    expect(kpi.denominator!.value).toBe(87_779.99);
    expect(kpi.label.en).toContain("all ad spend");
  });

  it("states the tracked ROAS over tracked-campaign spend only (≈3.27x)", () => {
    const kpi = closedLoopKpis(production()).roasTracked!;
    expect(kpi.value).toBe(3.27);
    expect(kpi.denominator!.label.en).toBe("Spend on campaigns with tracked leads");
  });

  it("gives every ratio its numerator, denominator and formula", () => {
    for (const kpi of Object.values(closedLoopKpis(production()))) {
      if (
        kpi.format === "count" ||
        kpi.key === "adSpend" ||
        kpi.key === "trackedSpend" ||
        kpi.key === "revenue"
      )
        continue;
      expect(kpi.numerator, kpi.key).toBeTruthy();
      expect(kpi.denominator, kpi.key).toBeTruthy();
      expect(kpi.formula, kpi.key).toContain("÷");
      if (kpi.status === "ok" && kpi.format !== "percent") {
        expect(kpi.value).toBeCloseTo(kpi.numerator!.value / kpi.denominator!.value, 1);
      }
    }
  });

  it("keeps CPL, CAC and cost per qualified consistent with their scope", () => {
    const kpis = closedLoopKpis(production());
    expect(kpis.cplAll!.value).toBe(5.52);
    expect(kpis.cplTracked!.value).toBe(5.32);
    expect(kpis.costPerCustomerAll!.value).toBe(121.58);
    expect(kpis.costPerCustomerTracked!.value).toBe(111.77);
    expect(kpis.costPerQualified!.value).toBe(44.91);
    expect(kpis.revenuePerLead!.value).toBe(17.39);
  });

  it("uses CRM-matched leads, not all leads, as the win-rate denominator", () => {
    const kpi = closedLoopKpis(production()).winRate!;
    expect(kpi.denominator!.value).toBe(15_161);
    expect(kpi.value).toBeCloseTo(722 / 15_161, 6);
  });
});

describe("unavailable is never shown as zero", () => {
  it("returns no value and pending_sync when Meta spend is not synced for the period", () => {
    const kpis = closedLoopKpis({
      ...production(),
      totalSpend: 0,
      trackedSpend: 0,
      spendSynced: false,
    });
    expect(kpis.adSpend!.value).toBeNull();
    expect(kpis.adSpend!.status).toBe("pending_sync");
    expect(kpis.roasAllSpend!.value).toBeNull();
    expect(kpis.roasAllSpend!.status).toBe("pending_sync");
  });

  it("returns no value when the denominator is zero rather than a fake 0 or Infinity", () => {
    const input = production();
    const kpis = closedLoopKpis({ ...input, tracked: metrics({ leads: 0 }), trackedSpend: 0 });
    expect(kpis.cplTracked!.status).toBe("no_denominator");
    expect(kpis.cplTracked!.value).toBeNull();
  });

  it("keeps a real zero as zero when the source was queried", () => {
    const kpis = closedLoopKpis({
      ...production(),
      tracked: metrics({ leads: 40, crmMatched: 40, won: 0, revenue: 0 }),
    });
    expect(kpis.won!.value).toBe(0);
    expect(kpis.won!.status).toBe("ok");
    expect(kpis.revenue!.value).toBe(0);
  });

  it("marks CRM outcomes pending until the graph has been built", () => {
    const kpis = closedLoopKpis({ ...production(), crmSynced: false });
    expect(kpis.won!.status).toBe("pending_sync");
    expect(kpis.won!.value).toBeNull();
  });
});

describe("cheap leads are not good leads", () => {
  it("pairs the cheapest creative with the best revenue-per-lead creative", () => {
    const rows = [
      { creativeId: "2521691128354570", leads: 149, spend: 97.26, cpl: 0.65, revenuePerLead: 0 },
      {
        creativeId: "914124471672780",
        leads: 165,
        spend: 1_427.25,
        cpl: 8.65,
        revenuePerLead: 47.41,
      },
      { creativeId: "tiny", leads: 12, spend: 5, cpl: 0.41, revenuePerLead: 90 },
    ];
    const pair = cheapVersusQuality(rows)!;
    expect(pair.cheapest.creativeId).toBe("2521691128354570");
    expect(pair.bestQuality.creativeId).toBe("914124471672780");
  });

  it("says nothing when one creative is both cheapest and best", () => {
    expect(
      cheapVersusQuality([
        { creativeId: "a", leads: 200, spend: 100, cpl: 0.5, revenuePerLead: 30 },
        { creativeId: "b", leads: 200, spend: 400, cpl: 2, revenuePerLead: 10 },
      ]),
    ).toBeNull();
  });
});
