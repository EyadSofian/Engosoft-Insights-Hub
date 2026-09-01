// Who may change a price, and what a refusal is allowed to say.
//
// Reading the price book is open, like every other page in this dashboard.
// Changing one is not: an unauthenticated POST that succeeded would let whoever
// found the URL rewrite what the compliance report calls a breach.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const { guard, body, authState, JSON_BODY_LIMIT } =
  await import("../src/lib/pricing/pricing-api.server.ts");
const { issueSessionCookie } = await import("../src/lib/admin-auth.server.ts");
const { z } = await import("zod");

const SECRET = "price-book-admin-secret-0123456789";
const SSO_SECRET = "workspace-shared-secret-for-tests-0123456789";

const reset = () => {
  delete process.env.DASHBOARD_ADMIN_SECRET;
  delete process.env.ENGOSOFT_SSO_SECRET;
};

const write = (headers = {}, payload = {}) =>
  new Request("https://app.test/api/pricing/items", {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

const read = () => new Request("https://app.test/api/pricing/catalog");

/* --- nothing configured: fail closed --------------------------------------- */

reset();
{
  const result = guard(write());
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 503, "an opt-out deployment refuses, and says so");
  const body503 = await result.response.json();
  assert.equal(body503.ok, false);
  assert.ok(body503.error.length > 0);
}
// Reading still works with nothing configured. The catalogue is not a secret.
assert.equal(authState(read()).editable, false);
assert.equal(authState(read()).signedIn, false);

/* --- admin code ------------------------------------------------------------ */

reset();
process.env.DASHBOARD_ADMIN_SECRET = SECRET;

// No credential.
{
  const result = guard(write());
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
}
// Wrong credential.
{
  const result = guard(write({ "x-admin-secret": "not-the-secret" }));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
}
// An empty header never matches, even against a configured secret.
{
  const result = guard(write({ "x-admin-secret": "" }));
  assert.equal(result.ok, false);
}
// A prefix of the real secret must not pass.
{
  const result = guard(write({ "x-admin-secret": SECRET.slice(0, 10) }));
  assert.equal(result.ok, false);
}
// The right credential does.
{
  const result = guard(write({ "x-admin-secret": SECRET }));
  assert.equal(result.ok, true);
  assert.equal(result.actor.via, "admin-code");
  assert.ok(result.label.length > 0, "an actor label is recorded for the change log");
}
// Bearer form works too, since that is what a script will reach for.
assert.equal(guard(write({ authorization: `Bearer ${SECRET}` })).ok, true);

/* --- a refusal must not leak the secret ------------------------------------ */

{
  const result = guard(write({ "x-admin-secret": "guess" }));
  const text = await result.response.clone().text();
  assert.ok(!text.includes(SECRET), "the response never contains the configured secret");
  assert.ok(!text.includes("guess"), "and never echoes what was supplied");
  assert.ok(!/DASHBOARD_ADMIN_SECRET\s*=/.test(text), "and never prints the variable with a value");
}
// The signed-in state a page reads carries no credential either.
{
  const state = JSON.stringify(authState(write({ "x-admin-secret": SECRET })));
  assert.ok(!state.includes(SECRET));
  assert.ok(state.includes("adminCode"), "it says a code is configured, not what it is");
}

/* --- workspace SSO --------------------------------------------------------- */

reset();
process.env.ENGOSOFT_SSO_SECRET = SSO_SECRET;

// A valid workspace session writes without any shared code.
{
  const cookie = issueSessionCookie({
    id: "u1",
    name: "Eyad",
    email: "eyad@engosoft.com",
    role: "manager",
  });
  const value = cookie.split(";")[0];
  const result = guard(write({ cookie: value }));
  assert.equal(result.ok, true);
  assert.equal(result.actor.via, "sso");
  assert.equal(result.label, "eyad@engosoft.com");
}
// A tampered session does not.
{
  const cookie = issueSessionCookie({ id: "u1", name: "Eyad", email: "e@x.com", role: "manager" });
  const [name, signed] = cookie.split(";")[0].split("=");
  const [payload] = signed.split(".");
  const forged = `${name}=${payload}.${createHmac("sha256", "wrong-key").update(payload).digest("base64url")}`;
  assert.equal(guard(write({ cookie: forged })).ok, false);
}
// With SSO configured but no code, a code header is not a way in.
assert.equal(guard(write({ "x-admin-secret": SECRET })).ok, false);

/* --- payload validation ---------------------------------------------------- */

reset();
process.env.DASHBOARD_ADMIN_SECRET = SECRET;

const schema = z.object({ price: z.number().max(100), label: z.string().default("x") });

// A malformed body is a 400 with a readable reason, not a 500.
{
  const request = new Request("https://app.test/api/pricing/items", {
    method: "PUT",
    body: "{not json",
  });
  const result = await body(request, schema);
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
}
// A schema violation names the field.
{
  const request = new Request("https://app.test/api/pricing/items", {
    method: "PUT",
    body: JSON.stringify({ price: 1000 }),
  });
  const result = await body(request, schema);
  assert.equal(result.ok, false);
  const detail = await result.response.json();
  assert.match(detail.error, /price/);
}
// Defaults are applied, so a handler receives a complete object.
{
  const request = new Request("https://app.test/api/pricing/items", {
    method: "PUT",
    body: JSON.stringify({ price: 10 }),
  });
  const result = await body(request, schema);
  assert.equal(result.ok, true);
  assert.equal(result.data.label, "x");
}
// An oversized body is refused on the bytes received, not on a header a client
// controls: a chunked upload has no Content-Length to check.
{
  const oversized = JSON.stringify({ price: 1, label: "x".repeat(2000) });
  const request = new Request("https://app.test/api/pricing/items", {
    method: "PUT",
    body: oversized,
  });
  const result = await body(request, schema, 512);
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 413);
}
assert.ok(JSON_BODY_LIMIT > 0 && JSON_BODY_LIMIT <= 1024 * 1024, "the JSON limit stays modest");

reset();
console.log("pricing security: all assertions passed");
