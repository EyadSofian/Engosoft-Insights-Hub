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
});
