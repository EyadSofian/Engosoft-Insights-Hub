import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { verifyChatwootWebhookSignature } from "@/lib/chatwoot-attribution.server";

const MAX_WEBHOOK_BYTES = 1_000_000;

function sameSecret(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function legacyAuthorized(request: Request): boolean {
  if (String(process.env.CHATWOOT_LEGACY_WEBHOOK_ENABLED || "true").toLowerCase() === "false") {
    return false;
  }
  const expected = (process.env.CHATWOOT_SYNC_SECRET || "").trim();
  if (!expected) return false;
  const url = new URL(request.url);
  const received = url.searchParams.get("secret") || request.headers.get("x-webhook-secret") || "";
  return Boolean(received) && sameSecret(received, expected);
}

/**
 * During rollout both authenticators are intentionally available: the deployed
 * legacy secret and Chatwoot's per-webhook native signature. Disable the former
 * with configuration only after native delivery has been verified.
 */
function authorized(request: Request, rawBody: string): boolean {
  const signature = request.headers.get("x-chatwoot-signature") || "";
  const timestamp = request.headers.get("x-chatwoot-timestamp") || "";
  const nativeSecret = (process.env.CHATWOOT_WEBHOOK_SECRET || "").trim();
  if (
    nativeSecret &&
    signature &&
    timestamp &&
    verifyChatwootWebhookSignature({
      rawBody,
      timestamp,
      signature,
      secret: nativeSecret,
      maxAgeSeconds: Number(process.env.CHATWOOT_WEBHOOK_MAX_AGE_SECONDS) || 300,
    })
  ) {
    return true;
  }
  return legacyAuthorized(request);
}

export const Route = createFileRoute("/api/chatwoot/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
          return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
        }
        const raw = await request.text();
        if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) {
          return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
        }
        if (!authorized(request, raw)) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        try {
          const [{ processChatwootAttributionEvent }, { ingestChatwootPhoneWebhook }] =
            await Promise.all([
              import("@/lib/chatwoot-attribution.server"),
              import("@/lib/chatwoot.server"),
            ]);
          const attribution = await processChatwootAttributionEvent({
            payload,
            rawBody: raw,
            deliveryId: request.headers.get("x-chatwoot-delivery") || undefined,
          });
          // Phone evidence remains the independent employee/CRM projection.
          const phone = await ingestChatwootPhoneWebhook(payload);
          return Response.json({ ok: true, attribution, phone });
        } catch (error) {
          const root =
            payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
          // Never log payloads, contacts or secret material. Reduced evidence
          // and the failure status are already durable in the event inbox.
          console.error("[chatwoot-webhook] durable processing failed", {
            event: typeof root.event === "string" ? root.event : "unknown",
            message: error instanceof Error ? error.message.slice(0, 240) : "processing failed",
          });
          return Response.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
        }
      },
    },
  },
});
