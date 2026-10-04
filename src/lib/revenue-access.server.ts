// Server-only gate for the Revenue workspace. The configured value is a
// scrypt hash, never the shared password itself.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const REVENUE_SESSION_COOKIE = "__Host-engosoft-revenue";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const HASH_PREFIX = "scrypt-v1";

const configuredHash = () => process.env.REVENUE_TAB_PASSWORD_HASH?.trim() ?? "";

function decodeUrlSafe(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function encodeUrlSafe(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function parseHash(value: string): { salt: Buffer; digest: Buffer } | null {
  const parts = value.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return null;
  const salt = decodeUrlSafe(parts[1]);
  const digest = decodeUrlSafe(parts[2]);
  return salt.length >= 16 && digest.length === 64 ? { salt, digest } : null;
}

/** One-time provisioning helper; only the salted hash is stored in Railway. */
export function hashRevenuePassword(password: string, salt = cryptoRandomSalt()): string {
  if (!password || Buffer.byteLength(password, "utf8") > 256)
    throw new Error("Revenue password must contain 1–256 UTF-8 bytes.");
  return `${HASH_PREFIX}$${encodeUrlSafe(salt)}$${encodeUrlSafe(
    scryptSync(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }),
  )}`;
}

function cryptoRandomSalt(): Buffer {
  return randomBytes(16);
}

export function revenuePasswordConfigured(): boolean {
  return parseHash(configuredHash()) !== null;
}

export function revenuePasswordMatches(password: string): boolean {
  const stored = configuredHash();
  const parsed = parseHash(stored);
  if (!parsed || !password || Buffer.byteLength(password, "utf8") > 256) return false;
  const candidate = scryptSync(password, parsed.salt, parsed.digest.length, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(candidate, parsed.digest);
}

function sessionKey(): Buffer | null {
  const stored = configuredHash();
  if (!parseHash(stored)) return null;
  return createHmac("sha256", stored).update("engosoft-revenue-session-v1").digest();
}

export function issueRevenueSessionCookie(now = Date.now()): string | null {
  const key = sessionKey();
  if (!key) return null;
  const body = encodeUrlSafe(
    JSON.stringify({ v: 1, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }),
  );
  const signature = encodeUrlSafe(createHmac("sha256", key).update(body).digest());
  return `${REVENUE_SESSION_COOKIE}=${body}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearRevenueSessionCookie(): string {
  return `${REVENUE_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function revenueSessionValid(request: Request, now = Date.now()): boolean {
  const key = sessionKey();
  if (!key) return false;
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${REVENUE_SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;
  const [body, signature] = match[1].split(".");
  if (!body || !signature) return false;
  const expected = encodeUrlSafe(createHmac("sha256", key).update(body).digest());
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    return false;
  try {
    const claims = JSON.parse(decodeUrlSafe(body).toString("utf8")) as {
      v?: unknown;
      exp?: unknown;
    };
    return claims.v === 1 && Number(claims.exp) * 1000 > now;
  } catch {
    return false;
  }
}

export function safeRevenueReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return "/accounting";
  const url = new URL(value, "https://revenue.invalid");
  if (url.origin !== "https://revenue.invalid") return "/accounting";
  if (url.pathname === "/accounting") return `${url.pathname}${url.search}`;
  if (url.pathname === "/courses") return `${url.pathname}${url.search}`;
  return "/accounting";
}

const attempts = new Map<string, { since: number; count: number }>();

export function allowRevenuePasswordAttempt(request: Request, now = Date.now()): boolean {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const state = attempts.get(key);
  if (!state || now - state.since > 15 * 60_000) {
    attempts.set(key, { since: now, count: 1 });
    if (attempts.size > 2_000)
      for (const [ip, entry] of attempts) if (now - entry.since > 15 * 60_000) attempts.delete(ip);
    return true;
  }
  state.count += 1;
  return state.count <= 8;
}

export function revenueGuardApplies(request: Request): boolean {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  if (path === "/accounting" || path === "/courses") return true;
  if (
    path === "/api/accounting" ||
    path === "/api/accounting-export" ||
    path === "/api/accounting-net-sales" ||
    path === "/api/profitability" ||
    path === "/api/profitability-ledger"
  )
    return true;
  return path === "/api/courses" || path === "/api/course-lead-alerts";
}

export function renderRevenueSignInPage(input: { next: string; error?: string }): string {
  const next = input.next.replace(
    /[&<>"]/gu,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string,
  );
  const error = input.error ? `<p class="error" role="alert">${input.error}</p>` : "";
  const form = revenuePasswordConfigured()
    ? `<form method="post" action="/api/revenue-access/login">
        <input type="hidden" name="next" value="${next}">
        <label for="password">كلمة مرور تبويب الإيرادات</label>
        <input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus>
        <button type="submit">فتح الإيرادات</button>
      </form>`
    : `<p class="error">قفل الإيرادات لم يُفعّل بعد. يلزم ضبط سر الدخول في إعدادات الإنتاج.</p>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>دخول الإيرادات · Engosoft</title>
<style>:root{color-scheme:light;--bg:#f3f6fb;--card:#fff;--ink:#132b49;--muted:#71839b;--line:#dce5f0;--accent:#1769e8;--err:#b42338}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:radial-gradient(circle at 50% 0,#e4efff 0,transparent 48%),var(--bg);color:var(--ink);font:15px/1.6 "IBM Plex Sans Arabic",system-ui,sans-serif;padding:24px}main{width:min(430px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:32px;box-shadow:0 18px 50px #173e6612}.mark{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;background:#eaf2ff;color:var(--accent);font-size:23px;font-weight:800}h1{font-size:22px;margin:18px 0 4px}p{color:var(--muted);margin:0 0 22px}form{display:grid;gap:11px}label{font-weight:650}input{font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink)}button{font:inherit;font-weight:700;padding:12px;border:0;border-radius:12px;background:var(--accent);color:#fff;cursor:pointer}button:hover{background:#0d56c5}.error{color:var(--err);font-size:14px;margin:0 0 14px}input:focus-visible,button:focus-visible{outline:3px solid #8dbbff;outline-offset:2px}</style></head><body><main><div class="mark" aria-hidden="true">₳</div><h1>منطقة الإيرادات محمية</h1><p>أدخل كلمة المرور للمتابعة إلى تقارير الإيرادات.</p>${error}${form}</main></body></html>`;
}
