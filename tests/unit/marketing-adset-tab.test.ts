import { describe, expect, it } from "vitest";
import { NAVIGATION_SECTIONS } from "../../src/lib/navigation";

describe("marketing Ad Sets tab", () => {
  it("has its own deep link and does not also select Creatives", () => {
    const marketing = NAVIGATION_SECTIONS.find((section) => section.id === "marketing");
    const adsets = marketing?.items.find((item) => item.search?.view === "adset-compare");
    const creatives = marketing?.items.find((item) => item.search?.view === "creatives");
    const location = { section: "ads", view: "adset-compare" };
    expect(adsets?.tabLabel?.en).toBe("Ad Sets");
    expect(adsets?.matches?.(location)).toBe(true);
    expect(creatives?.matches?.(location)).toBe(false);
  });
});
