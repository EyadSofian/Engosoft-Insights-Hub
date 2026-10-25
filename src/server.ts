import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { negotiateCompression, parseContentLength } from "./lib/response-compression";
import { startScheduler } from "./lib/scheduler.server";

// Registered once at module load. `startScheduler` is idempotent and returns
// early unless both Telegram variables are present.
// Local read-only CRM verification must not start unrelated scheduled jobs.
// Production behaviour is unchanged unless this explicit preview flag is set.
if (process.env.CRM_AUDIT_READ_ONLY_PREVIEW !== "true") {
  startScheduler();

  void import("./lib/meta-message-attribution.server")
    .then(({ startMetaAttributionWorker }) => startMetaAttributionWorker())
    .catch((error) => console.error("[meta-attribution] worker bootstrap failed:", error));

  // Explicit, idempotent schema migration for manual lead QA. Request handlers
  // only verify the tables exist; they never create them.
  void import("./lib/lead-qa.server")
    .then(({ startLeadQaMigration }) => startLeadQaMigration())
    .catch((error) => console.error("[lead-qa] migration bootstrap failed:", error));

  void import("./lib/closed-loop.server")
    .then(({ startClosedLoopWorker }) => startClosedLoopWorker())
    .catch((error) => console.error("[closed-loop] worker bootstrap failed:", error));

  void import("./lib/chatwoot-attribution-reconcile.server")
    .then(({ startChatwootReconcileWorker }) => startChatwootReconcileWorker())
    .catch((error) => console.error("[chatwoot-reconcile] worker bootstrap failed:", error));

  void import("./lib/meta-credential-health.server")
    .then(({ startMetaCredentialWorker }) => startMetaCredentialWorker())
    .catch((error) => console.error("[meta-credential] worker bootstrap failed:", error));

  void import("./lib/meta-messaging-readiness.server")
    .then(({ startMessagingReadinessWorker }) => startMessagingReadinessWorker())
    .catch((error) => console.error("[messaging-readiness] worker bootstrap failed:", error));

  void import("./lib/meta-leadgen.server")
    .then(({ startMetaLeadAdsWorker }) => startMetaLeadAdsWorker())
    .catch((error) => console.error("[meta-lead-ads] worker bootstrap failed:", error));
}

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

/**
 * Compress the response when the client asked for it and nothing else has.
 *
 * Railway's proxy does not: production returns `/api/filters` as 634 KB with no
 * `content-encoding` even when `gzip, br` is offered, and the HTML document as
 * 31 KB where gzip gives 5.8 KB.
 *
 * Streamed rather than buffered, so an SSR document still arrives progressively
 * and a large payload never has to sit in memory in full. `Content-Length` is
 * dropped because the compressed length is not known until the stream ends, and
 * a wrong one truncates the body.
 */
function compressResponse(request: Request, response: Response): Response {
  const encoding = negotiateCompression({
    acceptEncoding: request.headers.get("accept-encoding"),
    status: response.status,
    method: request.method,
    contentType: response.headers.get("content-type"),
    contentEncoding: response.headers.get("content-encoding"),
    contentLength: parseContentLength(response.headers.get("content-length")),
    hasBody: response.body !== null,
  });
  if (!encoding || !response.body) return response;

  const headers = new Headers(response.headers);
  headers.set("content-encoding", encoding);
  headers.delete("content-length");
  // Caches must not hand a gzipped body to a client that never asked for one.
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "accept-encoding");
  else if (!vary.toLocaleLowerCase("en").includes("accept-encoding"))
    headers.set("vary", `${vary}, accept-encoding`);

  return new Response(response.body.pipeThrough(new CompressionStream(encoding)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return compressResponse(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
