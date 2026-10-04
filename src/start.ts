import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import {
  renderRevenueSignInPage,
  revenueGuardApplies,
  revenueSessionValid,
  safeRevenueReturnPath,
} from "./lib/revenue-access.server";

const REVENUE_LOGIN_PATH = "/api/revenue-access/login";

const revenueAccessMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (url.pathname === REVENUE_LOGIN_PATH || !revenueGuardApplies(request)) return next();
  if (revenueSessionValid(request)) return next();

  if (url.pathname.startsWith("/api/")) {
    return Response.json(
      { error: "Revenue access requires a password." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const returnPath = safeRevenueReturnPath(`${url.pathname}${url.search}`);
  return new Response(renderRevenueSignInPage({ next: returnPath }), {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "x-robots-tag": "noindex, nofollow",
    },
  });
});

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

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, revenueAccessMiddleware],
}));
