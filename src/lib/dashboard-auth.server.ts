// Server-only: who may READ the dashboard.
//
// Reads were open because the workspace embeds Insights Hub in a plain iframe
// with no SSO connected. That exposed campaign spend, CRM statuses, revenue
// and attribution detail to anyone with the URL, so reads now require one of:
//
//  1. the workspace SSO session (once ENGOSOFT_SSO_SECRET is configured),
//  2. a sign-in session created with the existing DASHBOARD_ADMIN_SECRET code,
//  3. the admin code or INTERNAL_API_SECRET sent as a header by a trusted caller.
//
// Provider webhooks, the landing event collector, ingestion and static assets
// stay public: each authenticates itself (Meta/Chatwoot signatures, origin
// allowlist, ingest secret) and none of them returns dashboard data.
import { createHmac, timingSafeEqual } from "node:crypto";
import { authorizeService, authorizeWrite, ssoConfigured } from "./admin-auth.server";

export const READ_SESSION_COOKIE = "engosoft_insights_read";
const READ_SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_KEY_LABEL = "insights-read-session-v1";

const env = (name: string): string => process.env[name]?.trim() ?? "";

/** Explicit escape hatch only; any other value, including unset, enforces sign-in. */
export function readAuthEnforced(): boolean {
  return env("DASHBOARD_READ_AUTH").toLowerCase() !== "off";
}

export function readSignInAvailable(): boolean {
  return env("DASHBOARD_ADMIN_SECRET").length > 0 || ssoConfigured();
}

const PUBLIC_EXACT = new Set([
  "/api/health",
  "/api/chatwoot/webhook",
  "/api/telegram/webhook",
  "/api/landing-attribution/events",
  "/api/meta/whatsapp-attribution-webhook",
  "/api/meta/leadgen-webhook",
  "/favicon.ico",
  "/robots.txt",
]);

const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/ingest/",
  // Pricing endpoints for other Engosoft services enforce INTERNAL_API_SECRET themselves.
  "/api/prices/",
  "/assets/",
  "/_build/",
  "/landing-attribution/",
  "/engo-nexus/",
];

const STATIC_FILE =
  /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|webmanifest|txt)$/i;

export function isPublicPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC_EXACT.has(path)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix))) return true;
  return !path.startsWith("/api/") && STATIC_FILE.test(path);
}

const toB64url = (value: Buffer | string): string =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sessionKey(): Buffer | null {
  const secret = env("DASHBOARD_ADMIN_SECRET");
  // Derived, not the code itself: rotating the admin code ends every session.
  return secret ? createHmac("sha256", secret).update(SESSION_KEY_LABEL).digest() : null;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueReadSessionCookie(now = Date.now()): string | null {
  const key = sessionKey();
  if (!key) return null;
  const body = toB64url(
    JSON.stringify({
      v: 1,
      via: "admin-code",
      exp: Math.floor(now / 1000) + READ_SESSION_TTL_SECONDS,
    }),
  );
  const signature = toB64url(createHmac("sha256", key).update(body).digest());
  // SameSite=None + Partitioned so the session also works inside the workspace iframe.
  return `${READ_SESSION_COOKIE}=${body}.${signature}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${READ_SESSION_TTL_SECONDS}`;
}

export function clearReadSessionCookie(): string {
  return `${READ_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0`;
}

export function readSessionValid(request: Request, now = Date.now()): boolean {
  const key = sessionKey();
  if (!key) return false;
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${READ_SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;
  const [body, signature] = match[1].split(".");
  if (!body || !signature) return false;
  const expected = toB64url(createHmac("sha256", key).update(body).digest());
  if (!safeEqual(signature, expected)) return false;
  try {
    const claims = JSON.parse(fromB64url(body).toString("utf8")) as { exp?: unknown; v?: unknown };
    return claims.v === 1 && Number(claims.exp) * 1000 > now;
  } catch {
    return false;
  }
}

export function adminCodeMatches(code: string): boolean {
  const expected = env("DASHBOARD_ADMIN_SECRET");
  return Boolean(expected && code && safeEqual(code, expected));
}

export function authorizeRead(request: Request): boolean {
  if (readSessionValid(request)) return true;
  // Existing credentials: SSO session cookie or admin-code header.
  if (authorizeWrite(request).ok) return true;
  const hasServiceHeader = Boolean(request.headers.get("x-service-secret"));
  return hasServiceHeader && authorizeService(request).ok;
}

export type ReadDecision = { allow: true } | { allow: false; kind: "api" | "page" };

export function decideReadAccess(request: Request, pathname: string): ReadDecision {
  if (!readAuthEnforced()) return { allow: true };
  if (request.method === "OPTIONS") return { allow: true };
  if (isPublicPath(pathname)) return { allow: true };
  if (authorizeRead(request)) return { allow: true };
  return {
    allow: false,
    kind: pathname.startsWith("/api/") || pathname.startsWith("/_serverFn") ? "api" : "page",
  };
}

/** Same-origin relative paths only, so sign-in cannot be used as an open redirect. */
export function safeReturnPath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/api/") ? path : "/";
}

const attempts = new Map<string, { startedAt: number; count: number }>();

export function allowSignInAttempt(request: Request, now = Date.now()): boolean {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const current = attempts.get(key);
  if (!current || now - current.startedAt > 10 * 60_000) {
    attempts.set(key, { startedAt: now, count: 1 });
    if (attempts.size > 2_000)
      for (const [k, v] of attempts) if (now - v.startedAt > 10 * 60_000) attempts.delete(k);
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

export function resetSignInAttemptsForTests(): void {
  attempts.clear();
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string,
  );

export function renderSignInPage(input: {
  returnPath: string;
  error?: string;
  available: boolean;
}): string {
  const error = input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : "";
  const form = input.available
    ? `<form method="post" action="/api/auth/login">
        <input type="hidden" name="next" value="${escapeHtml(input.returnPath)}">
        <label for="code">Access code <span lang="ar" dir="rtl">رمز الدخول</span></label>
        <input id="code" name="code" type="password" autocomplete="current-password" required autofocus>
        <button type="submit">Sign in <span lang="ar" dir="rtl">دخول</span></button>
      </form>`
    : `<p>Sign-in is not configured on this deployment. Set DASHBOARD_ADMIN_SECRET or connect workspace SSO.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Engosoft Insights · Sign in</title>
<style>
:root{color-scheme:light dark;--bg:#eef2f4;--card:#fff;--ink:#13212b;--muted:#5d6e79;--line:#d3dce1;--accent:#1d4f73;--err:#b8322a}
@media (prefers-color-scheme:dark){:root{--bg:#0e161c;--card:#152029;--ink:#e4ecf0;--muted:#91a3ad;--line:#2a3a45;--accent:#8fc1e6;--err:#f08a80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px}
main{width:min(380px,100%);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 18px;color:var(--muted)}form{display:grid;gap:10px}
label{font-size:13px;font-weight:600;display:flex;justify-content:space-between;gap:8px}
input[type=password]{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink)}
button{font:inherit;font-weight:600;padding:10px 12px;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.error{color:var(--err);margin:0 0 12px}
</style></head><body><main>
<h1>Engosoft Insights</h1>
<p>This dashboard contains campaign, CRM and revenue data. Sign in to continue.</p>
${error}${form}
</main></body></html>`;
}
