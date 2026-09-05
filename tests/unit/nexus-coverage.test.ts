import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAVIGATION_SECTIONS } from "@/lib/navigation";
import {
  INSIGHTS_SURFACES,
  AGENT_FORBIDDEN_ENDPOINTS,
  surfaceForRoute,
  surfaceById,
} from "@/lib/agent-insights-registry";
import { pageTypeFor } from "@/components/engo-nexus/lib/nexus-context";

/** Every route the navigation actually shows a user. */
const NAV_ROUTES = NAVIGATION_SECTIONS.flatMap((section) => section.items.map((item) => item.to));

describe("no visible route ships without Nexus coverage", () => {
  it("finds the navigation it is meant to be checking", () => {
    expect(NAV_ROUTES.length).toBeGreaterThanOrEqual(16);
  });

  /**
   * THE FUTURE-PROOF TEST.
   *
   * A page added to the navigation without a registry entry fails here, on the
   * day it is written — rather than months later when someone asks Nexus about
   * it and is told the data does not exist.
   */
  it("maps every navigation route to a registry surface", () => {
    const unmapped = NAV_ROUTES.filter((route) => surfaceForRoute(route) === null);
    expect(unmapped).toEqual([]);
  });

  it("maps every navigation route to a page type that is not 'other'", () => {
    // /pricing, /weekend, /media-plan, /social-media and /organic all resolved
    // to "other", so Nexus could not tell which page the user was standing on.
    const untyped = NAV_ROUTES.filter((route) => pageTypeFor(route) === "other");
    expect(untyped).toEqual([]);
  });

  it("covers every navigation alias too", () => {
    const aliases = NAVIGATION_SECTIONS.flatMap((section) => section.aliases ?? []);
    for (const alias of aliases) {
      expect(surfaceForRoute(alias), alias).not.toBeNull();
    }
  });

  it("has a registry entry for every route file that renders a page", () => {
    const dir = join(import.meta.dirname, "..", "..", "src", "routes");
    const files = readdirSync(dir).filter((file) => file.endsWith(".tsx") && file !== "__root.tsx");
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      // Redirect-only aliases carry no analytics of their own.
      if (source.includes("throw redirect(")) continue;
      const route = file === "index.tsx" ? "/" : `/${file.replace(/\.tsx$/, "")}`;
      if (!surfaceForRoute(route)) missing.push(route);
    }
    expect(missing).toEqual([]);
  });
});

describe("the registry describes reality", () => {
  it("gives every surface a unique id", () => {
    const ids = INSIGHTS_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every analytical surface at least one endpoint and operation", () => {
    for (const surface of INSIGHTS_SURFACES) {
      if (surface.status === "NOT_APPLICABLE") continue;
      expect(surface.endpoints.length, surface.id).toBeGreaterThan(0);
      expect(surface.operations.length, surface.id).toBeGreaterThan(0);
    }
  });

  it("records the internal views that actually exist in the route files", () => {
    // Discovered by audit: these four pages switch analytical views without
    // changing the pathname, so a path alone cannot say what the user sees.
    expect(surfaceById("website")!.views).toEqual(["owner", "campaigns", "operations"]);
    expect(surfaceById("accounting")!.views).toEqual(["summary", "months", "profitability"]);
    expect(surfaceById("courses")!.views).toEqual(["campaigns", "alerts", "all"]);
    expect(surfaceById("lost")!.views).toEqual(["team", "course"]);
  });

  it("names only endpoints that exist as route files", () => {
    // The pricing entry pointed at "/api/pricing.catalog", which is the file
    // name, not the served path — the surface returned UPSTREAM_ERROR while
    // the page worked fine.
    const dir = join(import.meta.dirname, "..", "..", "src", "routes", "api");
    const served = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const match = /createFileRoute\("([^"]+)"\)/.exec(readFileSync(join(dir, file), "utf8"));
      if (match) served.add(match[1]!);
    }
    const missing: string[] = [];
    for (const surface of INSIGHTS_SURFACES) {
      for (const endpoint of surface.endpoints) {
        if (!served.has(endpoint)) missing.push(`${surface.id} -> ${endpoint}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("says where a surface keeps its figures when they are not in totals", () => {
    // Weekend and Media Plan returned a payload with no quotable numbers,
    // because theirs sit under portfolio.weekend and plan.
    expect(surfaceById("weekend")!.summaryPaths).toContain("portfolio.weekend");
    expect(surfaceById("media_plan")!.summaryPaths).toContain("plan");
  });

  it("names no forbidden endpoint as a readable source", () => {
    // A mutation reached by a misread sentence is not a risk worth carrying.
    for (const surface of INSIGHTS_SURFACES) {
      for (const endpoint of surface.endpoints) {
        expect(AGENT_FORBIDDEN_ENDPOINTS, `${surface.id} -> ${endpoint}`).not.toContain(endpoint);
      }
    }
  });

  it("flags the surfaces that can expose personal data", () => {
    // Leads carry phone and email; teams and lost carry named employees.
    for (const id of ["leads", "lost", "teams", "accounting", "media_buyers"]) {
      expect(surfaceById(id)!.sensitive, id).toBe(true);
    }
  });

  it("resolves a nested path to its surface", () => {
    expect(surfaceForRoute("/website/")!.id).toBe("website");
    expect(surfaceForRoute("/courses/anything")!.id).toBe("courses");
    expect(surfaceForRoute("/nope")).toBeNull();
  });

  it("routes every legacy alias to accounting", () => {
    for (const alias of ["/full-invoiced", "/products", "/sales"]) {
      expect(surfaceForRoute(alias)!.id, alias).toBe("accounting");
    }
  });
});

describe("coverage is reported honestly", () => {
  it("counts the visible analytical surfaces", () => {
    const analytical = INSIGHTS_SURFACES.filter((s) => s.status !== "NOT_APPLICABLE");
    expect(analytical).toHaveLength(16);
  });

  it("names why anything is less than fully connected", () => {
    for (const surface of INSIGHTS_SURFACES) {
      if (surface.status === "CONNECTED") continue;
      expect(surface.note, surface.id).toBeTruthy();
    }
  });
});
