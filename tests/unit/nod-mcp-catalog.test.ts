import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOD_ENDPOINTS, NOD_EXCLUDED_ENDPOINTS, matchNodEndpoint } from "@/lib/nod-mcp-catalog";
import { outline, sliceJson } from "@/lib/mcp-json-slice";

const API_DIR = join(process.cwd(), "src/routes/api");

function getRoutes(): string[] {
  return readdirSync(API_DIR)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(join(API_DIR, file), "utf8"))
    .filter((source) => /\bGET\s*:/u.test(source))
    .map((source) => source.match(/createFileRoute\("([^"]+)"\)/u)?.[1] ?? "")
    .filter(Boolean);
}

describe("Nod MCP endpoint catalog", () => {
  it("covers every GET route, or names why it is left out", () => {
    const catalogued = new Set(NOD_ENDPOINTS.map((endpoint) => endpoint.path));
    const missing = getRoutes().filter((route) => !catalogued.has(route) && !(route in NOD_EXCLUDED_ENDPOINTS));
    expect(missing).toEqual([]);
  });

  it("lists only routes that exist and serve GET", () => {
    const routes = new Set(getRoutes());
    expect(NOD_ENDPOINTS.map((endpoint) => endpoint.path).filter((path) => !routes.has(path))).toEqual([]);
  });

  it("never catalogues an excluded route", () => {
    expect(NOD_ENDPOINTS.filter((endpoint) => endpoint.path in NOD_EXCLUDED_ENDPOINTS)).toEqual([]);
  });

  it("matches catalogued paths and refuses everything else", () => {
    expect(matchNodEndpoint("/api/ads")?.path).toBe("/api/ads");
    expect(matchNodEndpoint("/api/ads/")?.path).toBe("/api/ads");
    expect(matchNodEndpoint("/api/pricing/invoices/abc-123")?.entry.path).toBe("/api/pricing/invoices/$movement");
    expect(matchNodEndpoint("/api/refresh")).toBeNull();
    expect(matchNodEndpoint("/api/employee-call-recording")).toBeNull();
    expect(matchNodEndpoint("/api/../api/refresh")).toBeNull();
    expect(matchNodEndpoint("https://evil.example/api/ads")).toBeNull();
    expect(matchNodEndpoint("/api/pricing/invoices/$movement")).toBeNull();
  });
});

describe("JSON slicing", () => {
  const payload = {
    totals: { spend: 10 },
    rows: Array.from({ length: 250 }, (_, i) => ({ id: i, name: `ad ${i}`, note: "x".repeat(50) })),
  };

  it("returns a payload that fits whole", () => {
    const result = sliceJson(payload, { maxChars: 400_000 });
    expect(result.outlineOnly).toBeUndefined();
    expect(result.data).toEqual(payload);
  });

  it("outlines a payload that does not fit, without dropping keys", () => {
    const result = sliceJson(payload, { maxChars: 10_000 });
    expect(result.outlineOnly).toBe(true);
    expect(result.data).toMatchObject({ totals: { spend: 10 }, rows: { _array: 250 } });
  });

  it("pages an array until nothing is left", () => {
    const seen: number[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const page = sliceJson(payload, { path: "rows", offset, limit: 100 });
      seen.push(...(page.data as { id: number }[]).map((row) => row.id));
      offset = page.nextOffset;
    }
    expect(seen).toEqual(payload.rows.map((row) => row.id));
  });

  it("shrinks a page that is too large instead of cutting rows", () => {
    const page = sliceJson(payload, { path: "rows", limit: 1000, maxChars: 10_000 });
    expect(page.returned).toBeLessThan(250);
    expect(page.nextOffset).toBe(page.returned);
  });

  it("reports a missing path with the keys that exist", () => {
    const result = sliceJson(payload, { path: "nope" });
    expect(result.kind).toBe("missing");
    expect(outline(payload, 1)).toMatchObject({ rows: { _array: 250 } });
  });
});
