import { createFileRoute } from "@tanstack/react-router";

/**
 * Exchanges a workspace SSO token for a session here.
 *
 * Implements the consumer half of the Engosoft workspace contract: HS256,
 * `iss: "engosoft-workspace"`, `aud: "insights"`, five-minute lifetime, token in
 * the body and never in the URL. The workspace calls this from the browser
 * before opening the app.
 *
 *   POST /api/auth/sso   { token }   credentials: include
 *
 * Until `ENGOSOFT_SSO_SECRET` is set this returns 503 rather than a session, so
 * a deployment that has not opted in cannot be signed into by this route.
 */
export const Route = createFileRoute("/api/auth/sso")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyWorkspaceToken, issueSessionCookie, ssoConfigured } =
          await import("@/lib/admin-auth.server");

        // `*` is not allowed with credentials, and echoing whatever Origin
        // arrives would let any site drive this route. Only the configured
        // workspace origin is permitted.
        const hub = process.env.ENGOSOFT_HUB_ORIGIN?.trim().replace(/\/+$/, "") ?? "";
        const origin = request.headers.get("origin") ?? "";
        const cors: Record<string, string> =
          hub && origin === hub
            ? {
                "access-control-allow-origin": hub,
                "access-control-allow-credentials": "true",
                vary: "origin",
              }
            : {};

        if (!ssoConfigured()) {
          return Response.json(
            { ok: false, error: "Workspace sign-in is not enabled on this deployment." },
            { status: 503, headers: { ...cors, "cache-control": "no-store" } },
          );
        }

        let token = "";
        try {
          const body = (await request.json()) as { token?: unknown };
          token = typeof body.token === "string" ? body.token : "";
        } catch {
          token = "";
        }
        if (!token) {
          return Response.json(
            { ok: false, error: "Missing token." },
            { status: 400, headers: { ...cors, "cache-control": "no-store" } },
          );
        }

        const claims = verifyWorkspaceToken(token);
        if (!claims) {
          return Response.json(
            { ok: false, error: "Invalid token." },
            { status: 401, headers: { ...cors, "cache-control": "no-store" } },
          );
        }

        const actor = {
          id: String(claims.sub ?? ""),
          name: String(claims.name ?? ""),
          email: String(claims.email ?? ""),
          role: String(claims.role ?? ""),
        };
        return Response.json(
          { ok: true, user: actor },
          {
            headers: {
              ...cors,
              "cache-control": "no-store",
              "set-cookie": issueSessionCookie(actor),
            },
          },
        );
      },

      OPTIONS: async ({ request }) => {
        const hub = process.env.ENGOSOFT_HUB_ORIGIN?.trim().replace(/\/+$/, "") ?? "";
        const origin = request.headers.get("origin") ?? "";
        if (!hub || origin !== hub) return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": hub,
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            "access-control-max-age": "600",
            vary: "origin",
          },
        });
      },
    },
  },
});
