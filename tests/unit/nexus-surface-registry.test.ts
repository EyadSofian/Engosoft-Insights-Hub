import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAVIGATION_SECTIONS } from "@/lib/navigation";
import {
  NEXUS_SURFACES,
  surfaceManifest,
  manifestForRoute,
  elementManifest,
  contextualQuestions,
} from "@/lib/nexus-surface-registry";
import {
  getNexusView,
  updateNexusView,
  clearNexusView,
  subscribeNexusView,
} from "@/components/engo-nexus/state/nexus-view-context";
import { buildPageContext } from "@/components/engo-nexus/lib/nexus-context";

const NAV_ROUTES = NAVIGATION_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

describe("every visible route has a manifest", () => {
  it("covers the whole navigation", () => {
    const missing = NAV_ROUTES.filter((route) => manifestForRoute(route) === null);
    expect(missing).toEqual([]);
  });

  it("gives every surface a title, description and questions", () => {
    for (const surface of NEXUS_SURFACES) {
      expect(surface.title.ar, surface.id).toBeTruthy();
      expect(surface.title.en, surface.id).toBeTruthy();
      expect(surface.description.ar.length, surface.id).toBeGreaterThan(20);
      expect(surface.suggestedQuestions.length, surface.id).toBeGreaterThan(0);
    }
  });

  it("registers the internal tabs the routes actually have", () => {
    // Discovered by audit — these four change view without changing the URL.
    expect(surfaceManifest("website")!.tabs.map((t) => t.id)).toEqual([
      "owner",
      "campaigns",
      "operations",
    ]);
    expect(surfaceManifest("accounting")!.tabs.map((t) => t.id)).toEqual([
      "summary",
      "months",
      "profitability",
    ]);
    expect(surfaceManifest("courses")!.tabs.map((t) => t.id)).toEqual([
      "campaigns",
      "alerts",
      "all",
    ]);
    expect(surfaceManifest("lost")!.tabs.map((t) => t.id)).toEqual(["team", "course"]);
  });

  it("gives every tab a summary a person can read", () => {
    for (const surface of NEXUS_SURFACES) {
      for (const tab of surface.tabs) {
        expect(tab.summary.ar.length, `${surface.id}.${tab.id}`).toBeGreaterThan(10);
      }
    }
  });
});

describe("elements carry meaning, not values", () => {
  it("gives every element a business meaning and a source", () => {
    for (const surface of NEXUS_SURFACES) {
      for (const element of surface.elements) {
        expect(element.meaning.ar.length, element.id).toBeGreaterThan(15);
        expect(element.sourceCapability, element.id).toBeTruthy();
        expect(element.questions.length, element.id).toBeGreaterThan(0);
      }
    }
  });

  it("holds no live figures", () => {
    // The registry is meaning. Values are fetched when a question is asked.
    const json = JSON.stringify(NEXUS_SURFACES);
    expect(json).not.toMatch(/"value"\s*:/);
    expect(json).not.toMatch(/\$[\d,]+\.\d\d/);
  });

  it("resolves an element by its stable id", () => {
    expect(elementManifest("course.campaigns")!.type).toBe("table");
    expect(elementManifest("website.sales")!.sourceCapability).toBe("website");
    expect(elementManifest("nope.nope")).toBeNull();
  });

  it("marks which elements need an entity chosen first", () => {
    expect(elementManifest("course.campaigns")!.requiresEntity).toBe("course");
    expect(elementManifest("overview.spend")!.requiresEntity).toBeUndefined();
  });
});

describe("contextual questions get more specific, not less", () => {
  it("prefers the focused element's questions over the page's", () => {
    const page = contextualQuestions("courses");
    const element = contextualQuestions("courses", "course.products");
    expect(element).not.toEqual(page);
    expect(element[0]).toContain("منتج");
  });

  it("falls back to the surface when nothing is focused", () => {
    expect(contextualQuestions("website").length).toBeGreaterThan(0);
  });

  it("caps the list so it stays a suggestion, not a menu", () => {
    for (const surface of NEXUS_SURFACES) {
      expect(contextualQuestions(surface.id).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("the view context tracks what the page declares", () => {
  it("starts empty and records an update", () => {
    clearNexusView();
    expect(getNexusView().surface).toBeNull();
    updateNexusView({ surface: "website", tab: "campaigns" });
    expect(getNexusView().tab).toBe("campaigns");
  });

  it("notifies subscribers when the tab changes", () => {
    clearNexusView();
    let calls = 0;
    const stop = subscribeNexusView(() => calls++);
    updateNexusView({ surface: "website", tab: "owner" });
    updateNexusView({ surface: "website", tab: "operations" });
    stop();
    expect(calls).toBe(2);
  });

  it("does not notify when nothing actually changed", () => {
    clearNexusView();
    updateNexusView({ surface: "website", tab: "owner" });
    let calls = 0;
    const stop = subscribeNexusView(() => calls++);
    updateNexusView({ surface: "website", tab: "owner" });
    stop();
    expect(calls).toBe(0);
  });

  it("clears on navigation so a stale tab cannot leak", () => {
    // Otherwise "حلل الصفحة دي" on Courses resolves against Website's tab.
    updateNexusView({ surface: "website", tab: "operations" });
    clearNexusView();
    expect(getNexusView()).toEqual({
      surface: null,
      tab: null,
      section: null,
      focusedElementId: null,
      selectedEntity: null,
    });
  });
});

describe("the view reaches the message context", () => {
  it("carries tab, section, element and entity", () => {
    const context = buildPageContext({
      path: "/website",
      language: "ar",
      filters: {} as never,
      view: {
        tab: "campaigns",
        section: "kpis",
        focusedElementId: "website.sales",
        selectedEntity: { type: "course", name: "PMP" },
      },
    });
    expect(context.view).toBe("campaigns");
    expect(context.section).toBe("kpis");
    expect(context.focusedElementId).toBe("website.sales");
    expect(context.entityName).toBe("PMP");
  });

  it("omits what the page did not declare", () => {
    const context = buildPageContext({
      path: "/website",
      language: "ar",
      filters: {} as never,
    });
    expect(context.view).toBeUndefined();
    expect(context.focusedElementId).toBeUndefined();
  });
});

describe("tabbed pages actually register themselves", () => {
  it("registers every page that has internal tabs", () => {
    // A tabbed page that does not register is invisible to Nexus.
    const dir = join(import.meta.dirname, "..", "..", "src", "routes");
    const tabbed = ["website.tsx", "accounting.tsx", "courses.tsx", "lost.tsx"];
    for (const file of tabbed) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).toContain("useRegisterNexusView");
    }
  });

  it("has no other route with tab state left unregistered", () => {
    const dir = join(import.meta.dirname, "..", "..", "src", "routes");
    const unregistered: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(join(dir, file), "utf8");
      if (source.includes("throw redirect(")) continue;
      // A useState over a union of string literals is an internal view.
      const hasTabs = /useState<"[^"]+"(?:\s*\|\s*"[^"]+")+>/.test(source);
      if (hasTabs && !source.includes("useRegisterNexusView")) unregistered.push(file);
    }
    /**
     * Empty, and it should stay that way.
     *
     * The detector matches a union of non-empty string literals, which is what
     * an analytical view looks like. /media-plan holds `"edit" | "create" |
     * null` and /pricing holds `"" | "recalculate" | "digest"` — administrative
     * dialog state, not views, and neither matches. A new page that adds a real
     * tab union without registering will appear here and fail.
     */
    expect(unregistered.sort()).toEqual([]);
  });
});

describe("the context frame carries what the page declared", () => {
  it("emits the tab, section and focused element", async () => {
    const { contextPreamble } = await import("@/components/engo-nexus/lib/nexus-context");
    // These were on the context object but never in the frame the agent sees,
    // so "اشرحلي التاب دي" arrived with only page=website.
    const frame = contextPreamble(
      buildPageContext({
        path: "/website",
        language: "ar",
        filters: {} as never,
        view: {
          tab: "campaigns",
          section: "kpis",
          focusedElementId: "website.sales",
        },
      }),
    );
    expect(frame).toContain("page=website");
    expect(frame).toContain("tab=campaigns");
    expect(frame).toContain("section=kpis");
    expect(frame).toContain("element=website.sales");
  });

  it("omits them when the page declared nothing", async () => {
    const { contextPreamble } = await import("@/components/engo-nexus/lib/nexus-context");
    const frame = contextPreamble(
      buildPageContext({ path: "/leads", language: "ar", filters: {} as never }),
    );
    expect(frame).toContain("page=leads");
    expect(frame).not.toContain("tab=");
    expect(frame).not.toContain("element=");
  });
});
