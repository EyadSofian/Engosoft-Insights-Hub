import { describe, expect, it } from "vitest";
import {
  NOT_MEASURABLE,
  formatCount,
  formatDate,
  formatDays,
  formatDelta,
  formatMetric,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
  inferDirection,
  isMeasurable,
  normalizeFloatNoise,
  trendTone,
} from "@/components/engo-nexus/lib/nexus-format";

describe("nexus-format — the float-noise defect", () => {
  it("formats the exact value that shipped to a user unrounded", () => {
    expect(formatMoney(138187.35635592628, "USD")).toBe("$138,187.36");
  });

  it("keeps each figure in its own currency", () => {
    expect(formatMoney(600, "SAR")).toBe("600.00 SAR");
    expect(formatMoney(7009.358714766733, "USD")).toBe("$7,009.36");
    expect(formatMoney(1500, "EGP")).toBe("1,500.00 EGP");
    expect(formatMoney(12.3456, "KWD")).toBe("12.346 KWD");
  });

  it("never renders an absent value as zero", () => {
    for (const bad of [null, undefined, NaN, Infinity, "600", {}]) {
      expect(formatMoney(bad, "SAR")).toBe(NOT_MEASURABLE);
      expect(formatCount(bad)).toBe(NOT_MEASURABLE);
      expect(formatPercent(bad)).toBe(NOT_MEASURABLE);
      expect(formatRatio(bad)).toBe(NOT_MEASURABLE);
      expect(formatDays(bad)).toBe(NOT_MEASURABLE);
    }
  });

  it("treats a real zero as a real value", () => {
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatCount(0)).toBe("0");
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("keeps the minus outside a symbol prefix", () => {
    expect(formatMoney(-1200, "USD")).toBe("-$1,200.00");
    expect(formatMoney(-1200, "SAR")).toBe("-1,200.00 SAR");
  });

  it("prints an unknown currency rather than hiding it", () => {
    expect(formatMoney(100, "XYZ")).toBe("100.00 XYZ");
    expect(formatMoney(100, null)).toBe("100.00");
    expect(formatMoney(100, "  ")).toBe("100.00");
  });

  it("clamps decimals and accepts only finite numbers", () => {
    expect(formatNumber(1.23456789, 99)).toBe("1.234568");
    expect(formatNumber(1.23456789, -5)).toBe("1");
    expect(isMeasurable(0)).toBe(true);
    expect(isMeasurable(NaN)).toBe(false);
    expect(isMeasurable("1")).toBe(false);
  });
});

describe("nexus-format — formatMetric routes by unit", () => {
  it("uses the right formatter for each unit", () => {
    expect(formatMetric(600, "money", "SAR")).toBe("600.00 SAR");
    expect(formatMetric(2.18978, "percent")).toBe("2.19%");
    expect(formatMetric(3.9169, "ratio")).toBe("3.92x");
    expect(formatMetric(6.66, "days")).toBe("6.7d");
    expect(formatMetric(6758, "count")).toBe("6,758");
    expect(formatMetric("Egypt", "text")).toBe("Egypt");
    expect(formatMetric(null, "text")).toBe(NOT_MEASURABLE);
    expect(formatMetric(5)).toBe("5");
  });
});

describe("nexus-format — deltas", () => {
  it("renders a zero delta as a finding, not as missing", () => {
    expect(formatDelta(0)).toBe("+0.00%");
  });

  it("signs each unit", () => {
    expect(formatDelta(23.19)).toBe("+23.19%");
    expect(formatDelta(-25.008)).toBe("−25.01%");
    expect(formatDelta(-12, "count")).toBe("−12");
    expect(formatDelta(1.5, "ratio")).toBe("+1.50x");
    expect(formatDelta(1.5, "money")).toBe("+1.50");
    expect(formatDelta(null)).toBe(NOT_MEASURABLE);
  });
});

describe("nexus-format — THE COLOUR RULE", () => {
  it("colours a falling CPL green and a falling revenue red", () => {
    expect(trendTone(-10, "lower_is_better")).toBe("positive");
    expect(trendTone(-10, "higher_is_better")).toBe("negative");
    expect(trendTone(10, "lower_is_better")).toBe("negative");
    expect(trendTone(10, "higher_is_better")).toBe("positive");
  });

  it("is neutral when the direction is unknown or the delta is flat", () => {
    expect(trendTone(10)).toBe("neutral");
    expect(trendTone(10, "neutral")).toBe("neutral");
    expect(trendTone(0, "higher_is_better")).toBe("neutral");
    expect(trendTone(null, "higher_is_better")).toBe("neutral");
    expect(trendTone(NaN, "lower_is_better")).toBe("neutral");
  });

  it("infers direction from the metric key, case- and space-insensitively", () => {
    expect(inferDirection("cpl")).toBe("lower_is_better");
    expect(inferDirection("CPA")).toBe("lower_is_better");
    expect(inferDirection("avg_close_days")).toBe("lower_is_better");
    expect(inferDirection("lost rate")).toBe("lower_is_better");
    expect(inferDirection("revenue")).toBe("higher_is_better");
    expect(inferDirection("conversionRate")).toBe("higher_is_better");
    expect(inferDirection("ROAS")).toBe("higher_is_better");
    expect(inferDirection("somethingNew")).toBe("neutral");
    expect(inferDirection(null)).toBe("neutral");
    expect(inferDirection(undefined)).toBe("neutral");
  });
});

describe("nexus-format — dates", () => {
  it("formats an ISO date and passes through anything else", () => {
    expect(formatDate("2026-10-09", "en")).toMatch(/09 Oct 2026/);
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate(null)).toBe(NOT_MEASURABLE);
    expect(formatDate(123)).toBe(NOT_MEASURABLE);
  });
});

describe("nexus-format — float noise in prose", () => {
  it("rounds the exact string the live bot produced", () => {
    // Verified against production on 2026-09-04.
    expect(
      normalizeFloatNoise("الإيرادات هذا الشهر حتى الآن هي **7009.358714766733**، وفقًا لأداة"),
    ).toContain("**7,009.36**");
  });

  it("keeps a grouped integer part intact", () => {
    // Regression: an earlier regex matched from the `0` after the comma and
    // rendered `7,009.358714766733` as `7,9.36` — a wrong number produced by
    // the guard itself. Caught by an end-to-end run against the live bot.
    expect(normalizeFloatNoise("الإيرادات 7,009.358714766733 دولار")).toBe(
      "الإيرادات 7,009.36 دولار",
    );
    expect(normalizeFloatNoise("1,234,567.891234567")).toBe("1,234,567.89");
    expect(normalizeFloatNoise("$138,187.35635592628")).toBe("$138,187.36");
  });

  it("rounds every long decimal in a sentence", () => {
    expect(normalizeFloatNoise("cpl 6.990175660156239 and roas 3.916969874680598")).toBe(
      "cpl 6.99 and roas 3.92",
    );
  });

  it("leaves real business precision alone", () => {
    const untouched = [
      "600 SAR",
      "12.5%",
      "3.92x",
      "code 109",
      "2026-09-04",
      "v5.5.1",
      "1,234.56",
      "0.75",
      "conversion 2.1898",
      "id 7d1a8999",
    ];
    for (const text of untouched) {
      expect(normalizeFloatNoise(text)).toBe(text);
    }
  });

  it("needs six decimals before it acts", () => {
    expect(normalizeFloatNoise("1.12345")).toBe("1.12345");
    expect(normalizeFloatNoise("1.123456")).toBe("1.12");
  });

  it("never touches a code span", () => {
    expect(normalizeFloatNoise("use `7009.358714766733` verbatim")).toBe(
      "use `7009.358714766733` verbatim",
    );
    expect(normalizeFloatNoise("```\n7009.358714766733\n```")).toContain("7009.358714766733");
  });

  it("handles empty and unusual input without throwing", () => {
    expect(normalizeFloatNoise("")).toBe("");
    expect(() => normalizeFloatNoise("`unclosed 1.1234567")).not.toThrow();
  });
});

describe("normalizeFloatNoise — model-written escape sequences", () => {
  it("turns a literal \\n the model typed into a real break", () => {
    // Observed live in a PMP pricing answer, before "المصدر: PriceEngo".
    const live = "سعر **PMP + Exam** هو **600 SAR**.\\n\\nالمصدر: PriceEngo";
    const out = normalizeFloatNoise(live);
    expect(out).not.toContain("\\n");
    expect(out).toBe("سعر **PMP + Exam** هو **600 SAR**.\n\nالمصدر: PriceEngo");
  });

  it("collapses the stray blank runs that came with it", () => {
    expect(normalizeFloatNoise("a.\n   \n\n   \nb")).toBe("a.\n\nb");
  });

  it("keeps an ordinary paragraph break exactly as it is", () => {
    expect(normalizeFloatNoise("one\n\ntwo")).toBe("one\n\ntwo");
    expect(normalizeFloatNoise("one\ntwo")).toBe("one\ntwo");
  });

  it("leaves an escape sequence inside a code span alone", () => {
    // There it is a literal being discussed, not a formatting mistake.
    expect(normalizeFloatNoise("use `\\n` to break")).toBe("use `\\n` to break");
  });

  it("still normalises float noise alongside the new cleanup", () => {
    expect(normalizeFloatNoise("الإيراد 7,009.358714766733\\n\\nالمصدر: Hub")).toBe(
      "الإيراد 7,009.36\n\nالمصدر: Hub",
    );
  });
});
