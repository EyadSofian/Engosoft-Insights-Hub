import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_CONTRACT_VERSION,
  AGENT_FORBIDDEN_ENDPOINTS,
  SURFACE_CONTRACTS,
  caveatsFor,
  contractById,
  contractForRoute,
  operationsFor,
  sourcesFor,
  type SurfaceContract,
  type SurfaceOperation,
} from "@/lib/agent-surface-contract";
import { readSurface } from "@/lib/agent-surface-gateway.server";
import { NAVIGATION_SECTIONS } from "@/lib/navigation";

/**
 * THE MANIFEST-DRIVEN CONTRACT SUITE.
 *
 * Every case here is generated from the contract itself, so a surface, a view
 * or an operation added tomorrow is tested the day it is declared — and a route
 * added without a contract fails the build rather than silently answering "I
 * don't have that data" months later.
 *
 * The gateway is driven with an injected fetch, so these assert on real merge,
 * projection and redaction behaviour without touching production.
 */

const ANALYTICAL = SURFACE_CONTRACTS.filter((s) => s.status !== "NOT_APPLICABLE");

/** Every (surface, view, operation) the contract promises. */
type Case = { contract: SurfaceContract; view: string | null; operation: SurfaceOperation };
const CASES: Case[] = ANALYTICAL.flatMap((contract) => {
  /**
   * `null` is included for EVERY surface, not only the ones without views.
   *
   * A caller that names no view was silently dropping every view-gated source:
   * `social_media` with no view returned the team aggregates and neither paid
   * nor organic. It must never be possible for an unspecified view to produce
   * less evidence than a specified one.
   */
  const views: Array<string | null> = [null, ...contract.views.map((v) => v.id)];
  return views.flatMap((view) =>
    operationsFor(contract, view).map((operation) => ({ contract, view, operation })),
  );
});

/**
 * A payload shaped like the dashboard's, tagged with which endpoint produced
 * it. That tag is how a test proves a source was actually read rather than
 * quietly replaced by the first one.
 */
const payloadFor = (endpoint: string) => ({
  totals: { spend: 100, revenue: 500 },
  summary: { leads: 25 },
  health: { crmAuthority: "postgres-live" },
  [`servedBy${endpoint.replace(/[^a-z]/gi, "")}`]: 1,
  asOf: "2026-08-31T00:00:00.000Z",
});

function stubFetch(seen: string[], failing: string[] = []) {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (failing.includes(url.pathname)) {
      return new Response("nope", { status: 503 });
    }
    return new Response(JSON.stringify(payloadFor(url.pathname)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** Arguments every source in a contract declares it needs. */
const auditArgs = (contract: SurfaceContract): Record<string, string> => {
  const args: Record<string, string> = { from: "2026-08-01", to: "2026-08-31" };
  for (const source of contract.sources) Object.assign(args, source.auditArgs ?? {});
  return args;
};

const paramsFor = (contract: SurfaceContract) => new URLSearchParams(auditArgs(contract));

describe("the contract describes reality", () => {
  it("versions itself", () => {
    expect(AGENT_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("gives every surface a unique id and at least one route", () => {
    const ids = SURFACE_CONTRACTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const surface of SURFACE_CONTRACTS) {
      expect(surface.routes.length, surface.id).toBeGreaterThan(0);
    }
  });

  it("names only endpoints that exist as route files", () => {
    const dir = join(import.meta.dirname, "..", "..", "src", "routes", "api");
    const served = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const match = /createFileRoute\("([^"]+)"\)/.exec(readFileSync(join(dir, file), "utf8"));
      if (match) served.add(match[1]!);
    }
    const missing: string[] = [];
    for (const surface of SURFACE_CONTRACTS) {
      for (const source of surface.sources) {
        if (!served.has(source.endpoint)) missing.push(`${surface.id} -> ${source.endpoint}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("never names a forbidden endpoint as a readable source", () => {
    for (const surface of SURFACE_CONTRACTS) {
      for (const source of surface.sources) {
        expect(AGENT_FORBIDDEN_ENDPOINTS as readonly string[], source.endpoint).not.toContain(
          source.endpoint,
        );
      }
    }
  });

  it("gives every source a reason a human can read", () => {
    for (const surface of SURFACE_CONTRACTS) {
      for (const source of surface.sources) {
        expect(source.why.length, `${surface.id}/${source.as}`).toBeGreaterThan(15);
      }
    }
  });

  it("gives every source that needs an argument a fixture argument to be tested with", () => {
    // /api/agent-course-intelligence answers HTTP 400 without `course`. The old
    // audit called it bare, printed the 400 and reported PASS.
    for (const surface of SURFACE_CONTRACTS) {
      for (const source of surface.sources) {
        if (!source.requiredArgs?.length) continue;
        for (const key of source.requiredArgs) {
          expect(source.auditArgs?.[key], `${surface.id}/${source.as} → ${key}`).toBeTruthy();
        }
      }
    }
  });

  it("declares a required argument as a filter the surface forwards", () => {
    for (const surface of SURFACE_CONTRACTS) {
      for (const source of surface.sources) {
        for (const key of source.requiredArgs ?? []) {
          expect(surface.filters, `${surface.id} must forward ${key}`).toContain(key);
        }
      }
    }
  });

  it("explains itself whenever it is not fully connected", () => {
    for (const surface of SURFACE_CONTRACTS) {
      if (surface.status === "CONNECTED") continue;
      expect(surface.note, surface.id).toBeTruthy();
    }
  });

  it("declares guide as explicitly not applicable rather than missing", () => {
    const guide = contractById("guide")!;
    expect(guide.status).toBe("NOT_APPLICABLE");
    expect(guide.sources).toEqual([]);
  });

  it("classifies the surfaces that can expose personal data", () => {
    for (const id of ["leads", "lost", "teams", "accounting", "media_buyers"]) {
      expect(contractById(id)!.sensitivity, id).toBe("personal");
    }
  });

  it("gives every analytical surface a standing caveat", () => {
    for (const surface of ANALYTICAL) {
      expect(caveatsFor(surface, null).length, surface.id).toBeGreaterThan(0);
    }
  });

  it("writes every caveat in both languages", () => {
    for (const surface of SURFACE_CONTRACTS) {
      for (const caveat of surface.caveats ?? []) {
        expect(caveat.ar.length, surface.id).toBeGreaterThan(10);
        expect(caveat.en.length, surface.id).toBeGreaterThan(10);
      }
    }
  });
});

describe("a new dashboard route cannot ship uncovered", () => {
  const NAV_ROUTES = NAVIGATION_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

  it("maps every navigation route to a contract", () => {
    expect(NAV_ROUTES.filter((route) => contractForRoute(route) === null)).toEqual([]);
  });

  it("maps every page route file to a contract", () => {
    const dir = join(import.meta.dirname, "..", "..", "src", "routes");
    const missing: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx") && f !== "__root.tsx")) {
      const source = readFileSync(join(dir, file), "utf8");
      if (source.includes("throw redirect(")) continue;
      const route = file === "index.tsx" ? "/" : `/${file.replace(/\.tsx$/, "")}`;
      if (!contractForRoute(route)) missing.push(route);
    }
    expect(missing).toEqual([]);
  });
});

describe("every surface, view and operation answers", () => {
  it("generates a case for every declared combination", () => {
    // If this drops, the suite silently stopped covering things.
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES.map((c) => [`${c.contract.id}${c.view ? `/${c.view}` : ""} [${c.operation}]`, c] as const))(
    "%s returns a usable typed result",
    async (_label, testCase) => {
      const seen: string[] = [];
      const result = await readSurface({
        surfaceId: testCase.contract.id,
        operation: testCase.operation,
        view: testCase.view,
        params: paramsFor(testCase.contract),
        origin: "http://hub.test",
        fetchImpl: stubFetch(seen),
      });

      expect(result.schemaVersion).toBe(AGENT_CONTRACT_VERSION);
      expect(["OK", "PARTIAL"]).toContain(result.status);
      expect(result.surface).toBe(testCase.contract.id);
      expect(result.operation).toBe(testCase.operation);
      expect(Object.keys(result.summary).length).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.coverage.sourcesOk).toBeGreaterThan(0);
      expect(result.caveats.length).toBeGreaterThan(0);
      // A raw payload must never travel — this is the megabyte guard.
      expect(result).not.toHaveProperty("data");
      expect(JSON.stringify(result).length).toBeLessThan(60_000);
    },
  );

  it.each(CASES.map((c) => [`${c.contract.id}${c.view ? `/${c.view}` : ""} [${c.operation}]`, c] as const))(
    "%s reads every source the contract resolves, not just the first",
    async (_label, testCase) => {
      const seen: string[] = [];
      await readSurface({
        surfaceId: testCase.contract.id,
        operation: testCase.operation,
        view: testCase.view,
        params: paramsFor(testCase.contract),
        origin: "http://hub.test",
        fetchImpl: stubFetch(seen),
      });
      const expected = sourcesFor(testCase.contract, {
        view: testCase.view,
        operation: testCase.operation,
        args: auditArgs(testCase.contract),
      }).map((source) => source.endpoint);
      expect(new Set(seen)).toEqual(new Set(expected));
    },
  );
});

describe("multi-source surfaces really are multi-source", () => {
  /**
   * THE BUG. `/api/agent-insights` did `surface.endpoints[0]!`, so a surface
   * built from three endpoints served one and still reported CONNECTED.
   */
  const MULTI: Array<[string, string | null, SurfaceOperation, string[]]> = [
    ["overview", null, "summary", ["/api/overview", "/api/teams"]],
    ["campaigns", null, "detail", ["/api/campaigns", "/api/campaign-risk"]],
    ["accounting", "profitability", "summary", ["/api/accounting", "/api/profitability"]],
    ["accounting", "summary", "summary", ["/api/accounting", "/api/sales"]],
    ["leads", null, "summary", ["/api/leads", "/api/crm-calls", "/api/uncalled-leads"]],
    ["media_plan", null, "summary", ["/api/media-plan", "/api/media-plan-activity"]],
    ["social_media", "organic", "summary", ["/api/organic", "/api/teams"]],
    ["courses", null, "detail", ["/api/courses", "/api/agent-course-intelligence"]],
  ];

  it.each(MULTI)("%s/%s [%s] reads all of its endpoints", async (id, view, operation, expected) => {
    const contract = contractById(id)!;
    const seen: string[] = [];
    await readSurface({
      surfaceId: id,
      operation,
      view,
      params: paramsFor(contract),
      origin: "http://hub.test",
      fetchImpl: stubFetch(seen),
    });
    for (const endpoint of expected) expect(seen, `${id} → ${endpoint}`).toContain(endpoint);
  });

  it("keeps two sources' identically-named figures apart", async () => {
    // Flattened bare, /api/organic's `revenue` silently replaced /api/ads'.
    const result = await readSurface({
      surfaceId: "social_media",
      operation: "summary",
      view: "organic",
      params: paramsFor(contractById("social_media")!),
      origin: "http://hub.test",
      fetchImpl: stubFetch([]),
    });
    const keys = Object.keys(result.summary);
    expect(keys).toContain("revenue");
    // The second source's collision arrives namespaced, never as a silent
    // overwrite of the first.
    expect(keys.some((key) => key.includes("."))).toBe(true);
  });

  it("names an optional source that failed instead of hiding it", async () => {
    const result = await readSurface({
      surfaceId: "leads",
      operation: "summary",
      view: null,
      params: paramsFor(contractById("leads")!),
      origin: "http://hub.test",
      fetchImpl: stubFetch([], ["/api/crm-calls"]),
    });
    expect(result.status).toBe("PARTIAL");
    expect(result.coverage.degraded).toContain("calls");
    expect(result.coverage.complete).toBe(false);
    // The primary answer still arrives.
    expect(Object.keys(result.summary).length).toBeGreaterThan(0);
  });

  it("fails loudly when a required source fails", async () => {
    const result = await readSurface({
      surfaceId: "leads",
      operation: "summary",
      view: null,
      params: paramsFor(contractById("leads")!),
      origin: "http://hub.test",
      fetchImpl: stubFetch([], ["/api/leads"]),
    });
    expect(result.status).toBe("UPSTREAM_ERROR");
    expect(result.reason).toMatch(/source failure/i);
    // Zero is never invented in place of a failure.
    expect(result.summary).toEqual({});
  });

  it("skips an optional source whose required argument was not supplied, and says so", async () => {
    const seen: string[] = [];
    const result = await readSurface({
      surfaceId: "courses",
      operation: "detail",
      view: null,
      // No `course` — the course-intelligence source cannot be called.
      params: new URLSearchParams({ from: "2026-08-01", to: "2026-08-31" }),
      origin: "http://hub.test",
      fetchImpl: stubFetch(seen),
    });
    expect(seen).not.toContain("/api/agent-course-intelligence");
    expect(["OK", "PARTIAL"]).toContain(result.status);
  });

  it("calls the course-intelligence source once a course is named", async () => {
    const seen: string[] = [];
    await readSurface({
      surfaceId: "courses",
      operation: "detail",
      view: null,
      params: new URLSearchParams({ from: "2026-08-01", to: "2026-08-31", course: "CFM" }),
      origin: "http://hub.test",
      fetchImpl: stubFetch(seen),
    });
    expect(seen).toContain("/api/agent-course-intelligence");
  });
});

describe("the gateway refuses what it should", () => {
  const base = {
    view: null,
    params: new URLSearchParams({ from: "2026-08-01", to: "2026-08-31" }),
    origin: "http://hub.test",
  };

  it("rejects an unknown surface", async () => {
    const result = await readSurface({
      ...base,
      surfaceId: "nope",
      operation: "summary",
      fetchImpl: stubFetch([]),
    });
    expect(result.status).toBe("UNKNOWN_ENTITY");
  });

  it("returns NOT_APPLICABLE for the guide, with a reason", async () => {
    const result = await readSurface({
      ...base,
      surfaceId: "guide",
      operation: "summary",
      fetchImpl: stubFetch([]),
    });
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.reason).toBeTruthy();
  });

  it("rejects an operation a surface does not support", async () => {
    const result = await readSurface({
      ...base,
      surfaceId: "weekend",
      operation: "search",
      fetchImpl: stubFetch([]),
    });
    expect(result.status).toBe("INVALID_FILTER");
    expect(result.reason).toMatch(/Supported/);
  });

  it("rejects a view a surface does not have", async () => {
    const result = await readSurface({
      ...base,
      surfaceId: "accounting",
      view: "made-up",
      operation: "summary",
      fetchImpl: stubFetch([]),
    });
    expect(result.status).toBe("INVALID_FILTER");
  });

  it("forwards only the filters the surface declares", async () => {
    const seen: string[] = [];
    let queried = "";
    const result = await readSurface({
      ...base,
      surfaceId: "weekend",
      operation: "summary",
      params: new URLSearchParams({
        from: "2026-08-01",
        to: "2026-08-31",
        // Weekend declares no salesperson filter; it must not travel.
        salesperson: "Someone",
      }),
      fetchImpl: (async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        seen.push(url.pathname);
        queried = url.search;
        return new Response(JSON.stringify(payloadFor(url.pathname)), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(result.filters).not.toHaveProperty("salesperson");
    expect(queried).not.toContain("salesperson");
  });
});

describe("a surface with views still answers when no view is named", () => {
  it.each(ANALYTICAL.filter((c) => c.views.length > 0).map((c) => [c.id, c] as const))(
    "%s resolves at least one source with no view",
    async (_id, contract) => {
      const sources = sourcesFor(contract, {
        view: null,
        operation: contract.operations[0]!,
        args: auditArgs(contract),
      });
      expect(sources.length).toBeGreaterThan(0);
    },
  );

  it("social_media reads BOTH paid and organic when no view is named", async () => {
    const seen: string[] = [];
    await readSurface({
      surfaceId: "social_media",
      operation: "summary",
      view: null,
      params: paramsFor(contractById("social_media")!),
      origin: "http://hub.test",
      fetchImpl: stubFetch(seen),
    });
    expect(seen).toContain("/api/ads");
    expect(seen).toContain("/api/organic");
  });

  it("accounting does NOT pull profitability into a plain summary", async () => {
    // It is a REQUIRED source for its own tab, so including it by default would
    // let a profitability outage sink an ordinary revenue question.
    const seen: string[] = [];
    await readSurface({
      surfaceId: "accounting",
      operation: "summary",
      view: null,
      params: paramsFor(contractById("accounting")!),
      origin: "http://hub.test",
      fetchImpl: stubFetch(seen),
    });
    expect(seen).not.toContain("/api/profitability");
    expect(seen).toContain("/api/accounting");
  });

  it("declares a default view wherever it declares views", () => {
    for (const contract of ANALYTICAL) {
      if (contract.views.length === 0) continue;
      expect(contract.defaultViews, contract.id).toBeTruthy();
      for (const view of contract.defaultViews ?? []) {
        expect(contract.views.map((v) => v.id), `${contract.id} → ${view}`).toContain(view);
      }
    }
  });
});
