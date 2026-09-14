import { createFileRoute } from "@tanstack/react-router";

async function readCredentials(request: Request): Promise<{ code: string; next: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return { code: String(body.code ?? ""), next: String(body.next ?? "/") };
  }
  const form = await request.formData().catch(() => null);
  return { code: String(form?.get("code") ?? ""), next: String(form?.get("next") ?? "/") };
}

/** Exchanges the dashboard access code for a signed read session. */
export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await import("@/lib/dashboard-auth.server");
        const { code, next } = await readCredentials(request);
        const returnPath = auth.safeReturnPath(next);
        const page = (error: string, status: number) =>
          new Response(
            auth.renderSignInPage({ returnPath, error, available: auth.readSignInAvailable() }),
            {
              status,
              headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
            },
          );

        if (!auth.allowSignInAttempt(request))
          return page("Too many attempts. Wait ten minutes and try again.", 429);
        if (!auth.adminCodeMatches(code.trim()))
          return page("That access code is not correct.", 401);
        const cookie = auth.issueReadSessionCookie();
        if (!cookie) return page("Sign-in is not configured on this deployment.", 503);
        return new Response(null, {
          status: 303,
          headers: { location: returnPath, "set-cookie": cookie, "cache-control": "no-store" },
        });
      },
    },
  },
});
