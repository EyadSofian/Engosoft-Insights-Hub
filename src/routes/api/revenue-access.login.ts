import { createFileRoute } from "@tanstack/react-router";

async function readInput(request: Request): Promise<{ password: string; next: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      password: typeof body.password === "string" ? body.password : "",
      next: typeof body.next === "string" ? body.next : "/accounting",
    };
  }
  const form = await request.formData().catch(() => null);
  return {
    password: String(form?.get("password") ?? ""),
    next: String(form?.get("next") ?? "/accounting"),
  };
}

export const Route = createFileRoute("/api/revenue-access/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          allowRevenuePasswordAttempt,
          issueRevenueSessionCookie,
          renderRevenueSignInPage,
          revenueRequestOriginMatches,
          revenuePasswordConfigured,
          revenuePasswordMatches,
          safeRevenueReturnPath,
        } = await import("@/lib/revenue-access.server");
        const input = await readInput(request);
        const next = safeRevenueReturnPath(input.next);
        const page = (message: string, status: number) =>
          new Response(renderRevenueSignInPage({ next, error: message }), {
            status,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store, private",
              "x-robots-tag": "noindex, nofollow",
            },
          });

        if (!revenueRequestOriginMatches(request))
          return page("تعذر التحقق من مصدر الطلب. أعد المحاولة من لوحة المعلومات.", 403);
        if (!allowRevenuePasswordAttempt(request))
          return page("محاولات كثيرة. انتظر 15 دقيقة ثم أعد المحاولة.", 429);
        if (!revenuePasswordConfigured())
          return page("قفل الإيرادات غير مضبوط على الإنتاج بعد.", 503);
        if (!revenuePasswordMatches(input.password)) return page("كلمة المرور غير صحيحة.", 401);

        const cookie = issueRevenueSessionCookie();
        if (!cookie) return page("تعذر إنشاء جلسة الدخول. راجع إعداد القفل.", 503);
        return new Response(null, {
          status: 303,
          headers: {
            location: next,
            "set-cookie": cookie,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
