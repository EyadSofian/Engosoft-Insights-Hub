import { describe, expect, it } from "vitest";
import { buyerReturn } from "../../src/lib/media-buyers";

describe("media buyer return credits delayed revenue with its own cost", () => {
  it("adds the earlier spend of a campaign paid after it stopped spending", () => {
    const result = buyerReturn(
      [
        { key: "live", spend: 100, revenue: 300 },
        { key: "stopped", spend: 0, revenue: 200 },
      ],
      new Map([["stopped", 400]]),
    );
    expect(result.spend).toBe(100);
    expect(result.earlierSpend).toBe(400);
    expect(result.delayedRevenue).toBe(200);
    expect(result.roasSpend).toBe(500);
    expect(result.roas).toBe(1);
  });

  it("keeps revenue with no recorded spend in the ratio and reports it", () => {
    const result = buyerReturn(
      [
        { key: "live", spend: 100, revenue: 300 },
        { key: "organic", spend: 0, revenue: 900 },
      ],
      new Map(),
    );
    expect(result.revenue).toBe(1200);
    expect(result.uncostedRevenue).toBe(900);
    expect(result.roasSpend).toBe(100);
    expect(result.roas).toBe(12);
  });

  it("ignores earlier spend for campaigns that also spent in the window", () => {
    const result = buyerReturn(
      [{ key: "live", spend: 100, revenue: 300 }],
      new Map([["live", 5_000]]),
    );
    expect(result.earlierSpend).toBe(0);
    expect(result.roas).toBe(3);
  });

  it("has no ratio without any spend to divide by", () => {
    expect(buyerReturn([{ key: "organic", spend: 0, revenue: 50 }], new Map()).roas).toBeNull();
    expect(buyerReturn([], new Map()).roas).toBeNull();
  });
});
