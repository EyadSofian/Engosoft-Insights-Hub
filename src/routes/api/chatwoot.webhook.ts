import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

const MAX_WEBHOOK_BYTES = 1_000_000;

function sameSecret(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute("/api/chatwoot/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = (process.env.CHATWOOT_SYNC_SECRET || "").trim();
        if (!expected) {
          return Response.json({ ok: false, error: "Webhook is not configured" }, { status: 503 });
        }
        const url = new URL(request.url);
        const received =
          url.searchParams.get("secret") || request.headers.get("x-webhook-secret") || "";
        if (!received || !sameSecret(received, expected)) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        const raw = await request.text();
        if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) {
          return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
        }
        try {
          const payload: unknown = JSON.parse(raw);
          const { ingestChatwootPhoneWebhook } = await import("@/lib/chatwoot.server");
          const result = await ingestChatwootPhoneWebhook(payload);
          return Response.json({ ok: true, ...result });
        } catch (error) {
          // A webhook delivery must be observable but must not trigger an
          // unbounded retry storm. Chatwoot sends a new event on the next real
          // change and the bounded backfill can repair any missed row.
          console.error(
            "[chatwoot-webhook] ingestion failed",
            error instanceof Error ? error.message : error,
          );
          return Response.json({ ok: false, accepted: false }, { status: 200 });
        }
      },
    },
  },
});
