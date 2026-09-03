// Server-only: who is allowed to change a published quota.
//
// This dashboard has no login of its own. It is launched from the Engosoft
// workspace (Qodo), but the workspace embeds it in a plain `<iframe src>` with
// no proxy and no token, so the workspace session does not reach this app —
// its own docs/SSO.md records Insights Hub as the app nothing was connected to.
// A read stays open, as every other page here is. A write must not.
//
// Two credentials are accepted, in this order:
//
//  1. A workspace SSO session, once `ENGOSOFT_SSO_SECRET` matches the
//     workspace's `SSO_SECRET`. This is the real answer: disabling someone in
//     the workspace user list ends their access here too.
//  2. `DASHBOARD_ADMIN_SECRET`, a shared code sent in a header. This works
//     today with no change in the workspace, and stops being reachable the
//     moment the variable is removed.
//
// With neither configured, writing is refused. A deployment that has not opted
// in must not be editable by whoever finds the URL.
import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "engosoft_insights_session";
/** Matches the workspace's own 12h session, and its 5m token TTL. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const AUDIENCE = "insights";
const ISSUER = "engosoft-workspace";

export interface Actor {
  /** How the caller proved themselves. */
  via: "sso" | "admin-code" | "service";
  /**
   * Workspace user id, `"admin-code"` when the shared code was used, or
   * `"service"` for a trusted server-to-server caller that acts for nobody.
   */
  id: string;
  name: string;
  email: string;
  role: string;
}

export type GuardResult =
  { ok: true; actor: Actor } | { ok: false; status: 401 | 403 | 503; error: string };

const env = (name: string): string => process.env[name]?.trim() ?? "";

export function ssoConfigured(): boolean {
  return env("ENGOSOFT_SSO_SECRET").length > 0;
}

export function adminCodeConfigured(): boolean {
  return env("DASHBOARD_ADMIN_SECRET").length > 0;
}

export function writesEnabled(): boolean {
  return ssoConfigured() || adminCodeConfigured();
}

export function serviceAuthConfigured(): boolean {
  return env("INTERNAL_API_SECRET").length > 0;
}

/** Constant-time compare that does not leak length through an early return. */
function secretMatches(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* --- JWT (HS256) ----------------------------------------------------------- */
// Hand-rolled rather than adding `jose`: this verifies one algorithm against one
// issuer and one audience, and the repo already prefers a small local
// implementation over a dependency for exactly this kind of need (see cron.ts).

const b64urlToBuffer = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export interface SsoClaims {
  sub?: unknown;
  name?: unknown;
  email?: unknown;
  role?: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  permissions?: unknown;
}

/**
 * Verify an HS256 token issued by the workspace.
 *
 * `aud` is checked against this app's id specifically. Skipping it would make an
 * HR token valid for opening the sales dashboard, which the workspace docs call
 * out as the one thing a consumer must not get wrong.
 */
export function verifyHs256(token: string, secret: string, audience: string): SsoClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  let algorithm: unknown;
  try {
    algorithm = (JSON.parse(b64urlToBuffer(header).toString("utf8")) as { alg?: unknown }).alg;
  } catch {
    return null;
  }
  if (algorithm !== "HS256") return null;

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const supplied = b64urlToBuffer(signature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  let claims: SsoClaims;
  try {
    claims = JSON.parse(b64urlToBuffer(payload).toString("utf8")) as SsoClaims;
  } catch {
    return null;
  }

  if (claims.iss !== ISSUER) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return null;
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  return claims;
}

export function verifyWorkspaceToken(token: string): SsoClaims | null {
  const secret = env("ENGOSOFT_SSO_SECRET");
  if (!secret) return null;
  return verifyHs256(token, secret, AUDIENCE);
}

/* --- session cookie -------------------------------------------------------- */
// The workspace token lives five minutes, which is not a working session. It is
// exchanged once for this app's own cookie, signed with the same shared secret.

const toB64url = (value: Buffer | string): string =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function issueSessionCookie(actor: Omit<Actor, "via">): string {
  const secret = env("ENGOSOFT_SSO_SECRET");
  const body = toB64url(
    JSON.stringify({ ...actor, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  );
  const signature = toB64url(createHmac("sha256", secret).update(body).digest());
  const value = `${body}.${signature}`;
  // `SameSite=None` because the workspace renders this app inside an iframe,
  // where a Lax cookie is never sent. Writes additionally require an explicit
  // header, so a bare cross-site POST cannot ride along on the cookie.
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_TTL_SECONDS}`;
}

function readSession(request: Request): Actor | null {
  const secret = env("ENGOSOFT_SSO_SECRET");
  if (!secret) return null;
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;

  const [body, signature] = match[1].split(".");
  if (!body || !signature) return null;
  const expected = toB64url(createHmac("sha256", secret).update(body).digest());
  if (!secretMatches(signature, expected)) return null;

  try {
    const claims = JSON.parse(b64urlToBuffer(body).toString("utf8")) as Record<string, unknown>;
    if (Number(claims.exp) * 1000 <= Date.now()) return null;
    return {
      via: "sso",
      id: String(claims.id ?? ""),
      name: String(claims.name ?? ""),
      email: String(claims.email ?? ""),
      role: String(claims.role ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Decide whether this request may change a quota.
 *
 * Deliberately says only whether it was accepted, never which credential was
 * missing or how close a supplied one was.
 */
export function authorizeWrite(request: Request): GuardResult {
  if (!writesEnabled()) {
    return {
      ok: false,
      status: 503,
      error:
        "Editing is not enabled on this deployment. Set DASHBOARD_ADMIN_SECRET, or connect the workspace with ENGOSOFT_SSO_SECRET.",
    };
  }

  const session = readSession(request);
  if (session) return { ok: true, actor: session };

  const expected = env("DASHBOARD_ADMIN_SECRET");
  if (expected) {
    const supplied =
      request.headers.get("x-admin-secret")?.trim() ||
      (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (supplied && secretMatches(supplied, expected)) {
      return {
        ok: true,
        actor: {
          via: "admin-code",
          id: "admin-code",
          name: "Admin code",
          email: "",
          role: "admin",
        },
      };
    }
  }

  return { ok: false, status: 401, error: "Unauthorized." };
}

/**
 * Decide whether this request may read on behalf of another Engosoft service.
 *
 * Not a user credential. It authenticates the *caller process* — the workspace
 * asking, from its own server, for the price a seller should quote — so it
 * carries no identity and grants nothing a person could be held to. The calling
 * app is responsible for deciding which of its users may ask; this only decides
 * that the app itself is who it says it is.
 *
 * Fails closed: with `INTERNAL_API_SECRET` unset there is no service caller, and
 * a deployment that has not opted in cannot be read this way. The refusal never
 * says which of the two it was.
 */
export function authorizeService(request: Request): GuardResult {
  const expected = env("INTERNAL_API_SECRET");
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "Service access is not enabled on this deployment.",
    };
  }

  const supplied =
    request.headers.get("x-service-secret")?.trim() ||
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!supplied || !secretMatches(supplied, expected)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  return {
    ok: true,
    actor: { via: "service", id: "service", name: "Service", email: "", role: "service" },
  };
}

export const SSO_SESSION_COOKIE = SESSION_COOKIE;
export const SSO_AUDIENCE = AUDIENCE;
