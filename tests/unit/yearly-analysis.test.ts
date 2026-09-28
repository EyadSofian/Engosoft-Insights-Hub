import { describe, expect, it } from "vitest";
import { annualAsYoyResult, buildAnnualComparison, type AnnualSource } from "@/lib/yearly-analysis";

function fixture(): AnnualSource {
  return {
    ads: [
      { date: "2026-01-12", spend: 20, courseHint: "PMP" },
      { date: "2026-09-28", spend: 30, courseHint: "PMP" },
      { date: "2026-09-29", spend: 40, courseHint: "PMP" },
      { date: "2025-09-28", spend: 10, courseHint: "PMP" },
      { date: "2025-09-29", spend: 80, courseHint: "PMP" },
    ] as AnnualSource["ads"],
    accounting: [
      { paymentDate: "2026-01-13", usdPaid: 100, course: "PMP", isCreditNote: false },
      { paymentDate: "2026-09-28", usdPaid: 200, course: "PMP", isCreditNote: false },
      { paymentDate: "2026-09-29", usdPaid: 300, course: "PMP", isCreditNote: false },
      { paymentDate: "2025-09-28", usdPaid: 80, course: "PMP", isCreditNote: false },
      { paymentDate: "2025-09-29", usdPaid: 90, course: "PMP", isCreditNote: false },
    ] as AnnualSource["accounting"],
    crm: [
      { createdAt: "2026-09-27", course: "PMP", isWon: true },
      { createdAt: "2026-09-28", course: "BIM", isWon: false },
      { createdAt: "2026-09-29", course: "PMP", isWon: true },
    ] as AnnualSource["crm"],
    lost: [
      { createdAt: "2026-09-28", course: "PMP" },
      { createdAt: "2026-09-29", course: "PMP" },
      { createdAt: "2025-09-28", course: "PMP" },
    ] as AnnualSource["lost"],
  };
}

describe("annual comparison", () => {
  it("cuts current and previous years at the same day of the selected month", () => {
    const result = buildAnnualComparison(
      fixture(),
      2026,
      9,
      "2026-09-28",
      (ad) => ad.courseHint ?? "",
    );
    expect(result.currentTo).toBe("2026-09-28");
    expect(result.previousTo).toBe("2025-09-28");
    expect(result.months).toHaveLength(9);
    expect(result.current.spend).toBe(50);
    expect(result.previous.spend).toBe(10);
    expect(result.current.revenue).toBe(300);
    expect(result.previous.revenue).toBe(80);
    expect(result.current.leads).toBe(3);
    expect(result.current.won).toBe(1);
    expect(result.current.lost).toBe(1);
    expect(result.current.lostRate).toBeCloseTo(100 / 3);
    expect(result.coverage.comparable.crm).toBe(false);
    expect(result.courses.find((row) => row.name === "PMP")?.current.revenue).toBe(300);
    expect(result.courses.find((row) => row.name === "PMP")?.current.spend).toBe(50);
    expect(result.courses.find((row) => row.name === "BIM")?.current.leads).toBe(1);
    const legacy = annualAsYoyResult(result);
    expect(legacy.spend).toHaveLength(9);
    expect(legacy.ytd.find((metric) => metric.metric === "revenue")?.current).toBe(300);
    expect(legacy.ytd.find((metric) => metric.metric === "spend")?.previous).toBe(10);
  });

  it("uses full completed months and keeps future months out", () => {
    const result = buildAnnualComparison(
      fixture(),
      2026,
      8,
      "2026-09-28",
      (ad) => ad.courseHint ?? "",
    );
    expect(result.currentTo).toBe("2026-08-31");
    expect(result.previousTo).toBe("2025-08-31");
    expect(result.months).toHaveLength(8);
    expect(result.current.revenue).toBe(100);
    expect(result.current.leads).toBe(0);
  });

  it("uses complete 2025 and 2024 Odoo cohorts without double-counting snapshot Lost", () => {
    const source: AnnualSource = {
      ...fixture(),
      historicalCrm: [
        { createdAt: "2025-09-27", course: "PMP", leads: 24, won: 3, lost: 5, inventoryLeads: 20 },
        { createdAt: "2024-09-27", course: "BIM", leads: 18, won: 2, lost: 4, inventoryLeads: 17 },
        { createdAt: "2024-09-29", course: "PMP", leads: 9, won: 1, lost: 1, inventoryLeads: 9 },
      ],
      historicalReadyYears: [2024, 2025],
    };
    const result = buildAnnualComparison(source, 2025, 9, "2026-09-28");
    expect(result.currentTo).toBe("2025-09-30");
    expect(result.previousTo).toBe("2024-09-30");
    expect(result.current.leads).toBe(24); // canonical Lost already belongs to the full Odoo pull
    expect(result.current.won).toBe(3);
    expect(result.previous.leads).toBe(27);
    expect(result.coverage.current.historical).toBe(24);
    expect(result.coverage.current.inventory).toBe(20);
    expect(result.coverage.previous.inventory).toBe(26);
    expect(result.coverage.comparable.crm).toBe(true);
    expect(result.courses.find((row) => row.name === "BIM")?.previous.leads).toBe(18);
    expect(annualAsYoyResult(result).metricAvailability.leads).toBe(true);
  });

  it("does not compare historical leads while either Odoo year is still missing", () => {
    const source: AnnualSource = {
      ...fixture(),
      historicalCrm: [
        { createdAt: "2025-09-27", course: "PMP", leads: 24, won: 3, lost: 5, inventoryLeads: 20 },
      ],
      historicalReadyYears: [2025],
    };
    const result = buildAnnualComparison(source, 2025, 9, "2026-09-28");
    expect(result.coverage.comparable.crm).toBe(false);
    expect(annualAsYoyResult(result).metricAvailability.leads).toBe(false);
  });

  it("cuts the 2025 Odoo cohort at the matching day for a live 2026 comparison", () => {
    const source: AnnualSource = {
      ...fixture(),
      historicalCrm: [
        { createdAt: "2025-09-28", course: "PMP", leads: 8, won: 1, lost: 2, inventoryLeads: 7 },
        { createdAt: "2025-09-29", course: "PMP", leads: 12, won: 3, lost: 4, inventoryLeads: 10 },
      ],
      historicalReadyYears: [2025],
    };
    const result = buildAnnualComparison(source, 2026, 9, "2026-09-28");
    expect(result.previousTo).toBe("2025-09-28");
    expect(result.previous.leads).toBe(8);
    expect(result.previous.won).toBe(1);
    expect(result.previous.lost).toBe(2);
    expect(result.coverage.previous.inventory).toBe(7);
  });
});
