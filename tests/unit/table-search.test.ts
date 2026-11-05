import { describe, expect, it } from "vitest";
import { searchTerms, tableSearchMatcher } from "@/lib/table-search";

describe("table search", () => {
  const name = "PMP-Ad1-20-July 25";
  it.each([
    name,
    "pmp ad1 20 july 25",
    "PMP_Ad 1_20_July_25",
    "july 25 pmp",
    "PMP–Ad1–٢٠–Jul ٢٥",
    "PMP/Ad1/۲۰/July/۲۵",
  ])("finds the ad with separators, case, word order and digit variants: %s", (query) => {
    expect(tableSearchMatcher(query)(name)).toBe(true);
  });
  it("requires every word and does not invent a fuzzy match", () => {
    expect(tableSearchMatcher("PMP July 25")(name)).toBe(true);
    expect(tableSearchMatcher("CFM July 25")(name)).toBe(false);
    expect(tableSearchMatcher("PMP August 25")(name)).toBe(false);
    expect(tableSearchMatcher("PMP Ad2")(name)).toBe(false);
  });
  it("normalizes Arabic and empty input without touching displayed text", () => {
    expect(tableSearchMatcher("إدارة المشاريع")("اداره المشروعات إدارةُ المشاريع")).toBe(true);
    expect(tableSearchMatcher("   ")("Anything")).toBe(true);
    expect(searchTerms("Ad١")).toEqual(["ad", "1"]);
  });
});
