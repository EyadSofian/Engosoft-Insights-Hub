import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Reads require a signed-in session. Provider webhooks, the landing collector,
 * ingestion and static assets stay public; see dashboard-auth.server.ts.
 */
const readAuthMiddleware = createMiddleware().server(async ({ request, pathname, next }) => {
  const auth = await import("./lib/dashboard-auth.server");
  const decision = auth.decideReadAccess(request, pathname);
  if (decision.allow) return next();
  if (decision.kind === "api") {
    return Response.json(
      { error: "Sign in required." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const url = new URL(request.url);
  return new Response(
    auth.renderSignInPage({
      returnPath: auth.safeReturnPath(url.pathname + url.search),
      available: auth.readSignInAvailable(),
    }),
    {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, readAuthMiddleware],
}));
