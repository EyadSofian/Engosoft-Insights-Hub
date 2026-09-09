import { describe, expect, it } from "vitest";
import { execSummary } from "@/lib/metrics.server";
import type { DataHealth } from "@/lib/metrics.server";
import { totals } from "../component/fixtures/overview-response";

const health = {
  platformsWithoutSpendTab: [],
  leadsWithoutSpendSource: 0,
  unpricedSources: [],
} as unknown as DataHealth;

describe("executive summary return labels", () => {
  it("uses campaign-attributed revenue for advertising ROAS", () => {
    const summary = execSummary(
      totals(),
      [],
      {},
      { from: "2026-08-01", to: "2026-08-09" },
      health,
    );

    expect(summary.ar).toContain("العائد الإعلاني المنسوب 2.55×");
    expect(summary.ar).toContain("إجمالي التحصيل ÷ الإنفاق الإعلاني 8.51×");
    expect(summary.ar).toContain("ليس ROAS إعلانيًا");
    expect(summary.ar).not.toContain("العائد الأساسي");

    expect(summary.en).toContain("attributed ad ROAS of 2.55×");
    expect(summary.en).toContain("All collected revenue ÷ ad spend is 8.51×");
    expect(summary.en).toContain("not advertising ROAS");
    expect(summary.en).not.toContain("primary ROAS");
  });
});
