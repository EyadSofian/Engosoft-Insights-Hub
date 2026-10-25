import { afterEach, describe, expect, it, vi } from "vitest";
import {
  READ_SESSION_COOKIE,
  adminCodeMatches,
  allowSignInAttempt,
  decideReadAccess,
  isPublicPath,
  issueReadSessionCookie,
  readSessionValid,
  resetSignInAttemptsForTests,
  safeReturnPath,
} from "@/lib/dashboard-auth.server";

const CODE = "test-admin-code-123456";

const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://insights.example.com${path}`, init);

function sessionHeader(now = Date.now()): string {
  const cookie = issueReadSessionCookie(now);
  if (!cookie) throw new Error("expected a cookie");
  return cookie.split(";")[0];
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetSignInAttemptsForTests();
});

describe("isPublicPath", () => {
  it("keeps provider webhooks, collectors, ingestion and assets public", () => {
    for (const path of [
      "/api/meta/whatsapp-attribution-webhook",
      "/api/meta/leadgen-webhook",
      "/api/chatwoot/webhook",
      "/api/telegram/webhook",
      "/api/landing-attribution/events",
      "/api/ingest/dataset",
      "/api/auth/login",
      "/api/health",
      "/assets/index-abc.js",
      "/landing-attribution/odoo-tracker.js",
    ])
      expect(isPublicPath(path), path).toBe(true);
  });

  it("protects dashboard data and pages", () => {
    for (const path of [
      "/api/ads",
      "/api/leads",
      "/api/attribution/summary",
      "/api/attribution/conversations",
      "/api/landing-attribution/summary",
      "/api/acquisition/summary",
      "/api/meta/lead-ads/operations",
      "/api/meta-destination-mix",
      "/attribution",
      "/",
    ])
      expect(isPublicPath(path), path).toBe(false);
  });
});

describe("decideReadAccess", () => {
  it("refuses unauthenticated data and page requests", () => {
    vi.stubEnv("DASHBOARD_ADMIN_SECRET", CODE);
    expect(decideReadAccess(request("/api/ads"), "/api/ads")).toEqual({
      allow: false,
      kind: "api",
    });
    expect(decideReadAccess(request("/attribution"), "/attribution")).toEqual({
      allow: false,
      kind: "page",
    });
    expect(
      decideReadAccess(
        request("/api/meta/leadgen-webhook", { method: "POST" }),
        "/api/meta/leadgen-webhook",
      ),
    ).toEqual({ allow: true });
  });

  it("accepts a signed session, the admin header, and preflight", () => {
    vi.stubEnv("DASHBOARD_ADMIN_SECRET", CODE);
    expect(
      decideReadAccess(request("/api/ads", { headers: { cookie: sessionHeader() } }), "/api/ads"),
    ).toEqual({ allow: true });
    expect(
      decideReadAccess(request("/api/ads", { headers: { "x-admin-secret": CODE } }), "/api/ads"),
    ).toEqual({ allow: true });
    expect(decideReadAccess(request("/api/ads", { method: "OPTIONS" }), "/api/ads")).toEqual({
      allow: true,
    });
  });

  it("honours the explicit escape hatch only", () => {
    vi.stubEnv("DASHBOARD_ADMIN_SECRET", CODE);
    vi.stubEnv("DASHBOARD_READ_AUTH", "off");
    expect(decideReadAccess(request("/api/ads"), "/api/ads")).toEqual({ allow: true });
    vi.stubEnv("DASHBOARD_READ_AUTH", "false");
    expect(decideReadAccess(request("/api/ads"), "/api/ads")).toEqual({
      allow: false,
      kind: "api",
    });
  });
});

describe("read sessions", () => {
  it("expires, rejects tampering, and dies when the code rotates", () => {
    vi.stubEnv("DASHBOARD_ADMIN_SECRET", CODE);
    const now = Date.now();
    const cookie = sessionHeader(now);
    expect(issueReadSessionCookie(now)).toContain("SameSite=None; Partitioned");
    expect(readSessionValid(request("/", { headers: { cookie } }), now)).toBe(true);
    expect(readSessionValid(request("/", { headers: { cookie } }), now + 13 * 60 * 60 * 1000)).toBe(
      false,
    );
    const [name, value] = cookie.split("=");
    expect(name).toBe(READ_SESSION_COOKIE);
    const tampered = `${name}=${value.slice(0, -2)}xx`;
    expect(readSessionValid(request("/", { headers: { cookie: tampered } }), now)).toBe(false);
    vi.stubEnv("DASHBOARD_ADMIN_SECRET", `${CODE}-rotated`);
    expect(readSessionValid(request("/", { headers: { cookie } }), now)).toBe(false);
  });

  it("matches the code in constant time and never without a configured code", () => {
    vi.stubEnv("DASHBOARD_ADMIN_SECRET", CODE);
    expect(adminCodeMatches(CODE)).toBe(true);
    expect(adminCodeMatches("wrong")).toBe(false);
    vi.stubEnv("DASHBOARD_ADMIN_SECRET", "");
    expect(adminCodeMatches("")).toBe(false);
    expect(issueReadSessionCookie()).toBeNull();
  });
});

describe("sign-in safety", () => {
  it("only returns to same-origin dashboard paths", () => {
    expect(safeReturnPath("/attribution?tab=1")).toBe("/attribution?tab=1");
    expect(safeReturnPath("//evil.example.com")).toBe("/");
    expect(safeReturnPath("https://evil.example.com")).toBe("/");
    expect(safeReturnPath("/api/ads")).toBe("/");
  });

  it("rate-limits repeated attempts from one client", () => {
    const req = request("/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    const results = Array.from({ length: 11 }, () => allowSignInAttempt(req));
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
  });
});
