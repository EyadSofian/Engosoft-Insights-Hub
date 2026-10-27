import { describe, expect, it } from "vitest";
import { classify, worstStatus } from "@/lib/source-reconciliation.server";

describe("reconciliation status", () => {
  it("is green only when the source was actually read", () => {
    expect(classify(null, 1000, "usd").status).toBe("SOURCE_UNAVAILABLE");
    expect(classify(1000, null, "usd").status).toBe("SOURCE_UNAVAILABLE");
    // A missing source never produces a difference to reason about.
    expect(classify(null, 1000, "usd").difference).toBeNull();
    expect(classify(null, 1000, "usd").differencePercent).toBeNull();
  });

  it("matches money to the cent and tolerates a settling last day", () => {
    // Meta, September 2026: $18,141.04 both sides.
    expect(classify(18141.04, 18141.04, "usd").status).toBe("MATCHED");
    // Meta, October 2026: 80 cents apart on a window ending today.
    expect(classify(18966.31, 18965.51, "usd").status).toBe("MATCHED");
    // Google Ads, October: half a cent.
    expect(classify(522.616664, 522.622021, "usd").status).toBe("MATCHED");
  });

  it("calls the September accounting gap a mismatch", () => {
    // Two invoice lines worth $5,324.93 missing from the stored dataset.
    const verdict = classify(163715.7, 158390.77, "usd");
    expect(verdict.status).toBe("MISMATCH");
    expect(verdict.difference).toBeCloseTo(-5324.93, 2);
    expect(verdict.differencePercent).toBeCloseTo(-3.25, 2);
  });

  it("separates a small money difference from a real one", () => {
    expect(classify(100000, 100300, "usd").status).toBe("SMALL_DIFFERENCE"); // 0.3%
    expect(classify(100000, 102000, "usd").status).toBe("MISMATCH"); // 2%
    // Under a dollar is never a finding, whatever the ratio.
    expect(classify(10, 10.5, "usd").status).toBe("MATCHED");
  });

  it("requires counts to be exact", () => {
    expect(classify(3451, 3451, "count").status).toBe("MATCHED");
    expect(classify(3451, 3450, "count").status).toBe("SMALL_DIFFERENCE");
    expect(classify(2216, 1296, "count").status).toBe("MISMATCH");
    // One lead off a tiny population is still a real difference.
    expect(classify(5, 4, "count").status).toBe("MISMATCH");
  });

  it("reports the difference from the dashboard's point of view", () => {
    // Dashboard below source is negative: the dashboard is missing money.
    expect(classify(1000, 900, "usd").difference).toBe(-100);
    expect(classify(1000, 1100, "usd").difference).toBe(100);
  });

  it("handles a zero source without dividing by it", () => {
    expect(classify(0, 0, "count").status).toBe("MATCHED");
    expect(classify(0, 0, "count").differencePercent).toBe(0);
    expect(classify(0, 7, "count").status).toBe("MISMATCH");
    expect(classify(0, 7, "count").differencePercent).toBeNull();
  });

  it("rolls a group up to its worst member, never its best", () => {
    expect(worstStatus(["MATCHED", "MATCHED"])).toBe("MATCHED");
    expect(worstStatus(["MATCHED", "SMALL_DIFFERENCE"])).toBe("SMALL_DIFFERENCE");
    // An unverifiable source outranks a small difference: it is not green.
    expect(worstStatus(["MATCHED", "SOURCE_UNAVAILABLE"])).toBe("SOURCE_UNAVAILABLE");
    expect(worstStatus(["SOURCE_UNAVAILABLE", "MISMATCH"])).toBe("MISMATCH");
    expect(worstStatus([])).toBe("MATCHED");
  });
});
