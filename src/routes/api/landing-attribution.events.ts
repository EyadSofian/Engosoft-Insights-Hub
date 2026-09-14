import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";
import {
  LANDING_EVENT_MAX_BYTES,
  allowLandingAttributionRequest,
  ingestLandingAttributionEvent,
  isLandingOriginAllowed,
  landingCorsHeaders,
  recordLandingAttributionRejection,
  validateLandingEvent,
} from "@/lib/landing-attribution.server";

function response(data: unknown, status: number, origin: string | null): Response {
  const headers = new Headers(landingCorsHeaders(origin));
  headers.set("cache-control", "no-store");
  return Response.json(data, { status, headers });
}

export const Route = createFileRoute("/api/landing-attribution/events")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (!isLandingOriginAllowed(origin))
          return response({ error: "Origin is not allowed" }, 403, origin);
        return new Response(null, { status: 204, headers: landingCorsHeaders(origin) });
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (!isLandingOriginAllowed(origin)) {
          void recordLandingAttributionRejection("origin_not_allowed");
          return response({ error: "Origin is not allowed" }, 403, origin);
        }
        if (!allowLandingAttributionRequest(request)) {
          void recordLandingAttributionRejection("rate_limited");
          return response({ error: "Too many analytics events" }, 429, origin);
        }
        const length = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(length) && length > LANDING_EVENT_MAX_BYTES) {
          void recordLandingAttributionRejection("body_too_large");
          return response({ error: "Event body is too large" }, 413, origin);
        }
        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > LANDING_EVENT_MAX_BYTES) {
          void recordLandingAttributionRejection("body_too_large");
          return response({ error: "Event body is too large" }, 413, origin);
        }
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          void recordLandingAttributionRejection("invalid_json");
          return response({ error: "Event must be valid JSON" }, 400, origin);
        }
        const event = validateLandingEvent(payload);
        if (!event) {
          void recordLandingAttributionRejection("invalid_payload");
          return response({ error: "Event does not match the attribution contract" }, 400, origin);
        }
        try {
          const result = await ingestLandingAttributionEvent(event, origin);
          return response({ accepted: true, duplicate: result.duplicate }, 202, origin);
        } catch (error) {
          console.error("landing attribution event ingest failed", error);
          // The caller never blocks the form on this response, but an honest
          // status lets staging monitoring detect a database configuration gap.
          return response({ error: "Attribution storage is unavailable" }, 503, origin);
        }
      },
    },
  },
});
