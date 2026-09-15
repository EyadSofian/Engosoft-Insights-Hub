import { describe, expect, it } from "vitest";
import {
  HEADER_SCROLL_THRESHOLD,
  nextHeaderState,
  type HeaderScrollState,
} from "@/lib/header-auto-hide";
import {
  itemIsActive,
  NAVIGATION_SECTIONS,
  navigationDrawerTree,
  sectionForLocation,
} from "@/lib/navigation";

const TOP = 120;

function run(positions: number[], pinnedAt: number[] = []): boolean[] {
  let state: HeaderScrollState = { hidden: false, anchorY: 0 };
  return positions.map((y, index) => {
    state = nextHeaderState(state, y, { topZone: TOP, pinned: pinnedAt.includes(index) });
    return state.hidden;
  });
}

describe("header auto-hide", () => {
  it("hides on a downward scroll past the top zone and returns on the way up", () => {
    expect(run([0, 200, 400, 380, 360])).toEqual([false, true, true, false, false]);
  });

  it("always shows near the top, whatever the direction", () => {
    expect(run([400, 100, 60])).toEqual([true, false, false]);
    expect(run([500, 110])).toEqual([true, false]);
  });

  it("ignores movement smaller than the threshold in either direction", () => {
    const small = HEADER_SCROLL_THRESHOLD - 1;
    expect(run([300, 300 + small])).toEqual([true, true]);
    // Shown, a tremble downward does not hide it.
    expect(run([300, 250, 250 + small, 250 - 2])).toEqual([true, false, false, false]);
  });

  it("measures travel from where the run started, not from the last frame", () => {
    // Four 4px steps up add up to a real upward scroll.
    expect(run([400, 396, 392, 388, 384])).toEqual([true, true, true, false, false]);
  });

  it("stays shown while something in the header is open", () => {
    expect(run([0, 300, 600], [1, 2])).toEqual([false, false, false]);
  });

  it("treats iOS rubber-band offsets as the top", () => {
    expect(run([500, -40])).toEqual([true, false]);
  });
});

describe("navigation", () => {
  const label = (item: { to: string; tabLabel?: { en: string } }) => item.tabLabel?.en ?? item.to;

  it("offers at most six primary destinations and four contextual tabs per workspace", () => {
    expect(NAVIGATION_SECTIONS.length).toBeLessThanOrEqual(6);
    for (const section of NAVIGATION_SECTIONS.filter((entry) => entry.contextual === "tabs")) {
      expect(section.items.length, section.id).toBeLessThanOrEqual(4);
    }
  });

  it("expands only the active workspace in the drawer", () => {
    const tree = navigationDrawerTree("/leads", {}, "en", label);
    const expanded = tree.filter((section) => section.children.length > 0 && !section.menu);
    expect(expanded.map((section) => section.key)).toEqual(["sales-crm"]);
    expect(expanded[0].children.find((report) => report.active)?.label).toBe("Leads");
  });

  it("puts creatives, lead sources and campaigns under one Marketing workspace", () => {
    const creatives = sectionForLocation("/acquisition", { section: "ads", view: "creatives" });
    const leads = sectionForLocation("/acquisition", { section: "leads" });
    const campaigns = sectionForLocation("/campaigns", {});
    const overview = sectionForLocation("/acquisition", {});
    expect([creatives?.id, leads?.id, campaigns?.id, overview?.id]).toEqual([
      "marketing",
      "marketing",
      "marketing",
      "marketing",
    ]);
    const marketing = NAVIGATION_SECTIONS.find((section) => section.id === "marketing")!;
    const active = marketing.items.filter((item) =>
      itemIsActive(item, "/acquisition", { section: "ads", view: "adsets" }),
    );
    expect(active.map((item) => item.tabLabel?.en)).toEqual(["Creatives"]);
  });

  it("keeps technical and specialist reports reachable under More", () => {
    expect(sectionForLocation("/acquisition", { section: "coverage" })?.id).toBe("more");
    for (const route of [
      "/ads",
      "/attribution",
      "/landing-pages",
      "/website",
      "/weekend",
      "/yoy",
    ]) {
      expect(sectionForLocation(route, {})?.id, route).toBe("more");
    }
  });

  it("keeps every legacy route inside some section", () => {
    const routes = [
      "/",
      "/campaigns",
      "/ads",
      "/acquisition",
      "/attribution",
      "/landing-pages",
      "/website",
      "/accounting",
      "/courses",
      "/pricing",
      "/leads",
      "/lost",
      "/teams",
      "/weekend",
      "/yoy",
      "/media-buyers",
      "/media-plan",
      "/social-media",
      "/organic",
      "/sales",
      "/full-invoiced",
    ];
    expect(routes.filter((route) => !sectionForLocation(route, {}))).toEqual([]);
  });

  it("separates the collection report from marketing → revenue on one route", () => {
    expect(sectionForLocation("/accounting", { view: "marketing" })?.id).toBe("revenue");
    const revenue = NAVIGATION_SECTIONS.find((section) => section.id === "revenue")!;
    const on = (search: Record<string, string>) =>
      revenue.items.filter((item) => itemIsActive(item, "/accounting", search)).length;
    expect(on({ view: "marketing" })).toBe(1);
    expect(on({ view: "months" })).toBe(1);
    expect(on({})).toBe(1);
  });
});
