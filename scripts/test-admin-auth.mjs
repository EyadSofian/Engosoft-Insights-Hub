import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// The guard reads process.env at call time, so each case sets what it needs.
const { authorizeWrite, verifyHs256, writesEnabled, issueSessionCookie, SSO_SESSION_COOKIE } =
  await import("../src/lib/admin-auth.server.ts");

const SECRET = "workspace-shared-secret-for-tests-0123456789";
const b64url = (value) =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function token(claims, secret = SECRET, alg = "HS256") {
  const header = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

const soon = () => Math.floor(Date.now() / 1000) + 300;
const valid = () => ({
  sub: "u1",
  name: "Eyad",
  email: "eyad@engosoft.com",
  role: "manager",
  iss: "engosoft-workspace",
  aud: "insights",
  exp: soon(),
});

const post = (headers = {}) =>
  new Request("https://app.test/api/targets", { method: "POST", headers });

const reset = () => {
  delete process.env.ENGOSOFT_SSO_SECRET;
  delete process.env.DASHBOARD_ADMIN_SECRET;
};

/* --- fail closed ----------------------------------------------------------- */
// The whole point: a deployment that has not opted in is not editable by
// whoever finds the URL, and says so with 503 rather than 401.
reset();
assert.equal(writesEnabled(), false);
{
  const result = authorizeWrite(post());
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
}
// Not even with a code, when no code is configured — an empty expected secret
// must never match an empty supplied one.
{
  const result = authorizeWrite(post({ "x-admin-secret": "" }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
}

/* --- admin code ------------------------------------------------------------ */
reset();
process.env.DASHBOARD_ADMIN_SECRET = "correct-horse-battery-staple";

assert.equal(writesEnabled(), true);
assert.equal(authorizeWrite(post()).ok, false, "no credential");
assert.equal(authorizeWrite(post({ "x-admin-secret": "wrong" })).ok, false);
assert.equal(
  authorizeWrite(post({ "x-admin-secret": "correct-horse-battery-stapl" })).ok,
  false,
  "a prefix of the secret must not pass",
);
{
  const result = authorizeWrite(post({ "x-admin-secret": "correct-horse-battery-staple" }));
  assert.equal(result.ok, true);
  assert.equal(result.actor.via, "admin-code");
}
// Bearer is accepted as an alternative to the dedicated header.
assert.equal(
  authorizeWrite(post({ authorization: "Bearer correct-horse-battery-staple" })).ok,
  true,
);

/* --- workspace tokens ------------------------------------------------------ */
reset();
process.env.ENGOSOFT_SSO_SECRET = SECRET;

assert.ok(verifyHs256(token(valid()), SECRET, "insights"), "a well-formed token verifies");

// An HR token must not open the sales dashboard — the workspace docs call this
// out as the one thing a consumer must not get wrong.
assert.equal(verifyHs256(token({ ...valid(), aud: "hr" }), SECRET, "insights"), null);
assert.equal(verifyHs256(token({ ...valid(), iss: "somewhere-else" }), SECRET, "insights"), null);
assert.equal(
  verifyHs256(token({ ...valid(), exp: Math.floor(Date.now() / 1000) - 10 }), SECRET, "insights"),
  null,
  "an expired token is refused",
);
assert.equal(verifyHs256(token(valid(), "a-different-secret"), SECRET, "insights"), null);
// `alg: none` is the classic JWT bypass and must be rejected outright.
assert.equal(verifyHs256(token(valid(), SECRET, "none"), SECRET, "insights"), null);
assert.equal(verifyHs256("not.a.token", SECRET, "insights"), null);
assert.equal(verifyHs256("", SECRET, "insights"), null);

/* --- session cookie -------------------------------------------------------- */
const cookie = issueSessionCookie({ id: "u1", name: "Eyad", email: "e@x.com", role: "manager" });
assert.ok(cookie.includes("HttpOnly"), "not readable from script");
assert.ok(cookie.includes("Secure"));
// The workspace renders this app in an iframe, where a Lax cookie is never sent.
assert.ok(cookie.includes("SameSite=None"));

const value = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
{
  const result = authorizeWrite(post({ cookie: `${SSO_SESSION_COOKIE}=${value}` }));
  assert.equal(result.ok, true);
  assert.equal(result.actor.via, "sso");
  assert.equal(result.actor.name, "Eyad");
}
// A tampered payload invalidates the signature.
{
  const [body, signature] = value.split(".");
  const forged = b64url(
    JSON.stringify({ id: "u2", name: "Someone else", exp: Math.floor(Date.now() / 1000) + 600 }),
  );
  const result = authorizeWrite(post({ cookie: `${SSO_SESSION_COOKIE}=${forged}.${signature}` }));
  assert.equal(result.ok, false);
  assert.notEqual(body, forged);
}

reset();
console.log("admin auth tests passed.");
