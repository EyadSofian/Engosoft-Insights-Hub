import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashRevenuePassword } from "@/lib/revenue-access.server";
import {
  handlePnlAccess,
  issuePnlCookie,
  pnlSessionValid,
  pnlPasswordMatches,
  PNL_COOKIE,
} from "@/lib/profitability-access.server";

const hash = hashRevenuePassword("test-only-pnl-key");
const root = "https://dashboard.example";
let ip = 0;
const req = (path: string, cookie?: string) =>
  new Request(root + path, { headers: cookie ? { cookie } : {} });
const login = (password: string, origin = root) =>
  new Request(root + "/api/profitability-access/login", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": `test-${ip++}`,
    },
    body: new URLSearchParams({ password }),
  });
beforeEach(() => {
  vi.stubEnv("PROFITABILITY_PASSWORD_HASH", hash);
});
describe("scoped P&L protection", () => {
  it.each([
    "/accounting",
    "/accounting?view=summary",
    "/accounting?view=net-sales",
    "/api/accounting",
    "/api/courses",
    "/api/teams",
    "/yoy",
    "/api/yoy",
  ])("keeps %s open", async (path) => {
    expect(await handlePnlAccess(req(path))).toBeNull();
  });
  it.each([
    "/api/profitability",
    "/api/profitability?compareMonth=2026-10",
    "/api/profitability?detailMonth=2026-10",
    "/api/profitability-ledger?ledgerCode=1",
    "/api/%70rofitability",
    "/api/profitability/",
  ])("blocks anonymous direct data access %s", async (path) => {
    const response = await handlePnlAccess(req(path));
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ code: "PNL_PASSWORD_REQUIRED" });
    expect(response?.headers.get("cache-control")).toContain("no-store");
  });
  it("shows a password form on the report only and does not expose a password", async () => {
    const response = await handlePnlAccess(req("/accounting?view=profitability"));
    const page = await response!.text();
    expect(page).toContain('type="password"');
    expect(page).not.toContain("test-only-pnl-key");
    expect(page).not.toContain(hash);
  });
  it("rejects incorrect passwords and cross-origin login", async () => {
    expect((await handlePnlAccess(login("wrong")))?.status).toBe(401);
    expect(
      (await handlePnlAccess(login("test-only-pnl-key", "https://evil.example")))?.status,
    ).toBe(403);
  });
  it("issues a secure session for the correct password with no open redirect", async () => {
    const response = await handlePnlAccess(login("test-only-pnl-key"));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/accounting?view=profitability");
    const cookie = response!.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(await handlePnlAccess(req("/api/profitability", cookie.split(";")[0]))).toBeNull();
  });
  it("rejects expired, tampered and old-key cookies", () => {
    const cookie = issuePnlCookie().split(";")[0];
    expect(pnlSessionValid(req("/api/profitability", cookie))).toBe(true);
    expect(pnlSessionValid(req("/api/profitability", cookie + "x"))).toBe(false);
    expect(pnlSessionValid(req("/api/profitability", issuePnlCookie(0)))).toBe(false);
    vi.stubEnv("PROFITABILITY_PASSWORD_HASH", hashRevenuePassword("rotated-test-only"));
    expect(pnlSessionValid(req("/api/profitability", cookie))).toBe(false);
  });
  it("fails closed when secret configuration is missing", async () => {
    vi.stubEnv("PROFITABILITY_PASSWORD_HASH", "");
    expect(pnlPasswordMatches("")).toBe(false);
    expect((await handlePnlAccess(req("/api/profitability")))?.status).toBe(401);
    expect((await handlePnlAccess(login("anything")))?.status).toBe(503);
  });
  it("bounds the password body and clears the scoped session on lock", async () => {
    expect((await handlePnlAccess(login("x".repeat(5000))))?.status).toBe(413);
    const response = await handlePnlAccess(
      new Request(root + "/api/profitability-access/logout", {
        method: "POST",
        headers: { origin: root },
      }),
    );
    expect(response?.headers.get("set-cookie")).toContain(PNL_COOKIE + "=;");
    expect(response?.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("rate-limits repeated password attempts", async () => {
    const attempt = () => new Request(root + "/api/profitability-access/login", {
      method: "POST",
      headers: { origin: root, "x-forwarded-for": "rate-limit-test" },
      body: "password=wrong",
    });
    for (let i = 0; i < 8; i++) expect((await handlePnlAccess(attempt()))?.status).toBe(401);
    expect((await handlePnlAccess(attempt()))?.status).toBe(429);
  });
});
