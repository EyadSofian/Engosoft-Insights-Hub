import { describe, expect, it } from "vitest";
import {
  HEADER_SCROLL_THRESHOLD,
  nextHeaderState,
  type HeaderScrollState,
} from "@/lib/header-auto-hide";
import { navigationDrawerTree } from "@/lib/navigation";

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

describe("navigation drawer tree", () => {
  const label = (item: { to: string }) => item.to;

  it("lists every section and expands only the active one", () => {
    const tree = navigationDrawerTree("/leads", undefined, "en", label);
    expect(tree.length).toBeGreaterThan(4);
    const expanded = tree.filter((section) => section.children.length > 0);
    expect(expanded.map((section) => section.key)).toEqual(["leads"]);
    expect(expanded[0].children.find((report) => report.active)?.to).toBe("/leads");
  });

  it("nests the five acquisition views under Acquisition performance when it is open", () => {
    const tree = navigationDrawerTree("/acquisition", "coverage", "en", label);
    const acquisition = tree
      .flatMap((section) => section.children)
      .find((report) => report.to === "/acquisition");
    expect(acquisition?.children.map((view) => view.label)).toEqual([
      "Overview",
      "Ads & creatives",
      "Leads & quality",
      "Sales & revenue",
      "Data coverage",
    ]);
    expect(acquisition?.children.filter((view) => view.active).map((view) => view.section)).toEqual(
      ["coverage"],
    );
  });

  it("marks Overview active when no acquisition section is in the URL", () => {
    const tree = navigationDrawerTree("/acquisition", undefined, "ar", label);
    const views = tree.flatMap((section) => section.children).flatMap((report) => report.children);
    expect(views.find((view) => view.active)?.section).toBe("overview");
    expect(views[0].label).toBe("نظرة عامة");
  });

  it("does not expose acquisition views from other pages", () => {
    const tree = navigationDrawerTree("/campaigns", undefined, "en", label);
    const views = tree.flatMap((section) => section.children).flatMap((report) => report.children);
    expect(views).toEqual([]);
  });
});
