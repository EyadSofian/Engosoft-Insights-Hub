import { describe, expect, it } from "vitest";
import { NAVIGATION_SECTIONS } from "../../src/lib/navigation";

describe("Ad Set comparison", () => {
  it("has its own deep link under the advanced tools and does not also select Creatives", () => {
    const more = NAVIGATION_SECTIONS.find((section) => section.id === "more");
    const marketing = NAVIGATION_SECTIONS.find((section) => section.id === "marketing");
    const adsets = more?.items.find((item) => item.search?.view === "adset-compare");
    const creatives = marketing?.items.find((item) => item.search?.view === "creatives");
    const location = { section: "ads", view: "adset-compare" };
    expect(adsets?.tabLabel?.en).toBe("Ad Set comparison");
    expect(adsets?.matches?.(location)).toBe(true);
    expect(creatives?.matches?.(location)).toBe(false);
  });
});
