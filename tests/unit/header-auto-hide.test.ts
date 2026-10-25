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

  it("offers at most six primary destinations and a bounded contextual strip", () => {
    expect(NAVIGATION_SECTIONS.length).toBeLessThanOrEqual(6);
    /**
     * The cap is per section: each strip lists one audience's reports, flat,
     * with no second strip inside the page. Marketing and CRM carry the most
     * because their audiences genuinely work across that many reports.
     */
    const cap: Record<string, number> = { marketing: 6, leads: 5, crm: 7 };
    for (const section of NAVIGATION_SECTIONS.filter((entry) => entry.contextual === "tabs")) {
      expect(section.items.length, section.id).toBeLessThanOrEqual(cap[section.id] ?? 4);
    }
  });

  it("expands only the active workspace in the drawer", () => {
    const tree = navigationDrawerTree("/leads", {}, "en", label);
    const expanded = tree.filter((section) => section.children.length > 0 && !section.menu);
    expect(expanded.map((section) => section.key)).toEqual(["crm"]);
    // `/leads` with no view is the CRM table; the views that share the
    // pathname must not light up with it.
    expect(expanded[0].children.filter((report) => report.active).map((r) => r.label)).toEqual([
      "CRM records",
    ]);
    expect(expanded[0].children[0]?.to).toBe("/leads");
    expect(expanded[0].children[0]?.search).toBeUndefined();
  });

  it("groups reports by the audience that reads them", () => {
    const at = (route: string, search: Record<string, string> = {}) =>
      sectionForLocation(route, search)?.id;
    expect([at("/"), at("/management-review"), at("/yoy")]).toEqual([
      "overview",
      "overview",
      "overview",
    ]);
    expect([
      at("/acquisition"),
      at("/campaigns"),
      at("/acquisition", { section: "ads", view: "creatives" }),
      at("/media-plan"),
      at("/media-buyers"),
      at("/website"),
    ]).toEqual(["marketing", "marketing", "marketing", "marketing", "marketing", "marketing"]);
    expect([
      at("/acquisition", { section: "leads" }),
      at("/lead-sources"),
      at("/lead-distribution"),
      at("/leads", { view: "weekly" }),
      at("/leads", { view: "intelligence" }),
    ]).toEqual(["leads", "leads", "leads", "leads", "leads"]);
    expect([
      at("/leads"),
      at("/leads", { view: "performance" }),
      at("/leads", { view: "channels" }),
      at("/teams"),
      at("/lost"),
      at("/leads", { view: "lost" }),
      at("/leads", { view: "quality" }),
    ]).toEqual(["crm", "crm", "crm", "crm", "crm", "crm", "crm"]);
    expect([
      at("/accounting"),
      at("/accounting", { view: "marketing" }),
      at("/courses", { view: "sales" }),
      at("/pricing"),
    ]).toEqual(["revenue", "revenue", "revenue", "revenue"]);
    const marketing = NAVIGATION_SECTIONS.find((section) => section.id === "marketing")!;
    const active = marketing.items.filter((item) =>
      itemIsActive(item, "/acquisition", { section: "ads", view: "adsets" }),
    );
    expect(active.map((item) => item.tabLabel?.en)).toEqual(["Creatives"]);
  });

  it("keeps technical and specialist reports reachable under advanced tools", () => {
    expect(sectionForLocation("/acquisition", { section: "coverage" })?.id).toBe("more");
    expect(sectionForLocation("/acquisition", { section: "sales" })?.id).toBe("more");
    expect(sectionForLocation("/acquisition", { section: "ads", view: "adset-compare" })?.id).toBe(
      "more",
    );
    expect(sectionForLocation("/courses", { view: "ads" })?.id).toBe("more");
    for (const route of ["/ads", "/weekend", "/attribution", "/landing-pages", "/organic"]) {
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
      "/lead-distribution",
      "/lost",
      "/teams",
      "/management-review",
      "/lead-sources",
      "/creatives",
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
