import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { startScheduler } from "./lib/scheduler.server";

// Registered once at module load. `startScheduler` is idempotent and returns
// early unless both Telegram variables are present.
startScheduler();

/**
 * Pull the data snapshot into memory while the process is starting, rather than
 * inside the first request that needs it.
 *
 * Reading it costs a full pass over every dataset in PostgreSQL — ~28 MB for
 * CRM alone. Without this the first visitor after every deploy or restart waits
 * for all of it before seeing a single number, which is the same stall the
 * background refresh removes for everyone else.
 *
 * Deliberately not awaited: the server must start accepting requests
 * immediately. A request arriving before this finishes joins the same in-flight
 * load instead of starting a second one. A failure here is not fatal either —
 * the snapshot is simply loaded on demand, as it was before — so it is logged
 * and swallowed rather than allowed to take the process down at boot.
 */
void import("./lib/sheet-cache.server")
  .then(({ loadAllData }) => loadAllData())
  .catch((error) => console.error("[warm-up] snapshot preload failed:", error));

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
