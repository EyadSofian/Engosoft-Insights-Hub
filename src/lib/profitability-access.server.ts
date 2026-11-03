// P&L only: no global dashboard or revenue sign-in is enabled by this gate.
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { allowRevenuePasswordAttempt, revenueRequestOriginMatches } from "./revenue-access.server";

export const PNL_COOKIE = "__Host-engosoft-pnl";
const TTL = 8 * 60 * 60;
const PNL_PATH = "/accounting?view=profitability";
const LOGIN = "/api/profitability-access/login";
const LOGOUT = "/api/profitability-access/logout";
const stored = () => process.env.PROFITABILITY_PASSWORD_HASH?.trim() ?? "";
function parsedHash() {
  const [version, salt, digest, extra] = stored().split("$");
  if (version !== "scrypt-v1" || !salt || !digest || extra) return null;
  const parts = { salt: Buffer.from(salt, "base64url"), digest: Buffer.from(digest, "base64url") };
  return parts.salt.length >= 16 && parts.digest.length === 64 ? parts : null;
}
export function pnlPasswordMatches(password: string): boolean {
  const parts = parsedHash();
  if (!parts || !password || Buffer.byteLength(password) > 256) return false;
  return timingSafeEqual(
    parts.digest,
    scryptSync(password, parts.salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }),
  );
}
const signature = (body: string) =>
  createHmac("sha256", stored())
    .update("engosoft-pnl-v1:" + body)
    .digest("base64url");
export function issuePnlCookie(now = Date.now()): string {
  if (!parsedHash()) throw new Error("P&L access is not configured");
  const body = Buffer.from(JSON.stringify({ v: 1, exp: Math.floor(now / 1000) + TTL })).toString(
    "base64url",
  );
  return `${PNL_COOKIE}=${body}.${signature(body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL}`;
}
export function pnlSessionValid(request: Request, now = Date.now()): boolean {
  if (!parsedHash()) return false;
  const value = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(PNL_COOKIE + "="))
    ?.slice(PNL_COOKIE.length + 1);
  if (!value) return false;
  const [body, sig, extra] = value.split(".");
  if (!body || !sig || extra) return false;
  const actual = Buffer.from(sig),
    expected = Buffer.from(signature(body));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    return claims.v === 1 && Number.isFinite(claims.exp) && claims.exp * 1000 > now;
  } catch {
    return false;
  }
}
export function pnlGuardApplies(request: Request): boolean {
  const url = new URL(request.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname).replace(/\/+$/u, "");
  } catch {
    return false;
  }
  return (
    path === "/api/profitability" ||
    path === "/api/profitability-ledger" ||
    (path === "/accounting" && url.searchParams.get("view") === "profitability")
  );
}
const headers = {
  "cache-control": "private, no-store",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};
function loginPage(error = "", status = 200): Response {
  // Error text is selected internally, never interpolated from request input.
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الأرباح والخسائر · Engosoft</title>
  <style>body{margin:0;background:#f3f6fb;color:#142c49;font:16px/1.7 system-ui;min-height:100vh;display:grid;place-items:center}main{background:white;border:1px solid #dce5f0;border-radius:22px;padding:32px;width:min(380px,80vw)}h1{font-size:23px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;font:inherit;border:1px solid #ccd8e8;border-radius:10px}button{background:#0045fe;color:white;cursor:pointer}a{color:#0045fe}.error{color:#b42338}</style></head>
  <body><main><h1>الأرباح والخسائر محمية</h1><p>أدخل كلمة المرور لعرض هذا التقرير فقط. باقي الإيرادات متاحة بدون كلمة مرور.</p><p class="error" role="alert">${error}</p>
  <form method="post" action="${LOGIN}"><label for="password">كلمة المرور</label><input id="password" name="password" type="password" required maxlength="256" autocomplete="current-password" autofocus><button>فتح الأرباح والخسائر</button></form>
  <a href="/accounting">العودة إلى الإيرادات</a></main></body></html>`,
    {
      status,
      headers: {
        ...headers,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}

/** Run at the server boundary before any report handler or its caches. */
export async function handlePnlAccess(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === LOGIN && request.method === "POST") {
    if (!revenueRequestOriginMatches(request))
      return loginPage("أعد المحاولة من رابط الداشبورد نفسه.", 403);
    if (!allowRevenuePasswordAttempt(request))
      return loginPage("محاولات كثيرة. انتظر 15 دقيقة.", 429);
    if (!parsedHash()) return loginPage("قفل التقرير لم يُضبط بعد.", 503);
    if (Number(request.headers.get("content-length") ?? 0) > 4096)
      return loginPage("طلب غير صالح.", 413);
    // Bound the body even when content-length is absent or forged.
    const reader = request.body?.getReader();
    let body = "",
      size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 4096) {
          await reader.cancel();
          return loginPage("طلب غير صالح.", 413);
        }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    }
    const password = new URLSearchParams(body).get("password") ?? "";
    if (!pnlPasswordMatches(password)) return loginPage("كلمة المرور غير صحيحة.", 401);
    return new Response(null, {
      status: 303,
      headers: { ...headers, location: PNL_PATH, "set-cookie": issuePnlCookie() },
    });
  }
  if (url.pathname === LOGOUT && request.method === "POST") {
    if (!revenueRequestOriginMatches(request)) return loginPage("طلب غير صالح.", 403);
    return new Response(null, {
      status: 303,
      headers: {
        ...headers,
        location: PNL_PATH,
        "set-cookie": `${PNL_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    });
  }
  if (!pnlGuardApplies(request) || pnlSessionValid(request)) return null;
  if (url.pathname.startsWith("/api/"))
    return Response.json(
      { code: "PNL_PASSWORD_REQUIRED", error: "Profit and Loss requires its password." },
      { status: 401, headers },
    );
  return loginPage();
}
