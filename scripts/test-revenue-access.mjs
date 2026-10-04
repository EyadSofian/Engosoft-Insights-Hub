import assert from "node:assert/strict";
import {
  hashRevenuePassword,
  revenuePasswordConfigured,
  revenuePasswordMatches,
  issueRevenueSessionCookie,
  revenueSessionValid,
  safeRevenueReturnPath,
  revenueGuardApplies,
  revenueRequestOriginMatches,
} from "../src/lib/revenue-access.server.ts";

const password = "testing-only-revenue-password";
process.env.REVENUE_TAB_PASSWORD_HASH = hashRevenuePassword(password, Buffer.alloc(16, 7));
assert.equal(revenuePasswordConfigured(), true);
assert.equal(revenuePasswordMatches(password), true);
assert.equal(revenuePasswordMatches("wrong"), false);

const now = 1_800_000_000_000;
const cookieHeader = issueRevenueSessionCookie(now);
assert.match(cookieHeader, /^__Host-engosoft-revenue=/u);
assert.match(cookieHeader, /HttpOnly; Secure; SameSite=Lax/u);
const cookie = cookieHeader.split(";", 1)[0];
assert.equal(
  revenueSessionValid(new Request("https://example.test/accounting", { headers: { cookie } }), now),
  true,
);
assert.equal(
  revenueSessionValid(
    new Request("https://example.test/accounting", { headers: { cookie } }),
    now + 8 * 60 * 60_000 + 1,
  ),
  false,
);

assert.equal(
  safeRevenueReturnPath("/accounting?view=profitability"),
  "/accounting?view=profitability",
);
assert.equal(safeRevenueReturnPath("https://attacker.test/"), "/accounting");
assert.equal(revenueGuardApplies(new Request("https://example.test/api/profitability")), true);
assert.equal(revenueGuardApplies(new Request("https://example.test/api/teams")), false);
assert.equal(revenueGuardApplies(new Request("https://example.test/accounting?view=months")), true);
assert.equal(revenueGuardApplies(new Request("https://example.test/courses?view=sales")), true);
assert.equal(revenueGuardApplies(new Request("https://example.test/api/courses")), true);
assert.equal(
  revenueRequestOriginMatches(
    new Request("http://internal-service/api/revenue-access/login", {
      method: "POST",
      headers: {
        origin: "https://insights.example.test",
        host: "internal-service",
        "x-forwarded-host": "insights.example.test",
      },
    }),
  ),
  true,
  "a reverse proxy must compare the browser host with the forwarded public host",
);
assert.equal(
  revenueRequestOriginMatches(
    new Request("https://example.test/api/revenue-access/login", {
      method: "POST",
      headers: { origin: "https://attacker.test", host: "example.test" },
    }),
  ),
  false,
);

console.log("Revenue password gate: hash verification, signed session, expiry and scope passed.");
