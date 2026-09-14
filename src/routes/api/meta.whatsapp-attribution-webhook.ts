import { createFileRoute } from "@tanstack/react-router";
import {
  ingestMetaMessageAttributionWebhook,
  processPendingMetaAttributionEvents,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from "@/lib/meta-message-attribution.server";

const MAX_META_WEBHOOK_BYTES = 1_000_000;

export const Route = createFileRoute("/api/meta/whatsapp-attribution-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const challenge = verifyMetaWebhookChallenge({
          mode: params.get("hub.mode") || "",
          verifyToken: params.get("hub.verify_token") || "",
          expectedToken: process.env.META_ATTRIBUTION_VERIFY_TOKEN?.trim() || "",
          challenge: params.get("hub.challenge") || "",
        });
        return challenge === null
          ? new Response("Forbidden", { status: 403 })
          : new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
      },
      POST: async ({ request }) => {
        const length = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(length) && length > MAX_META_WEBHOOK_BYTES) {
          return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
        }
        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody) > MAX_META_WEBHOOK_BYTES) {
          return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
        }
        const appSecret = process.env.META_ATTRIBUTION_APP_SECRET?.trim() || "";
        const signature = request.headers.get("x-hub-signature-256") || "";
        if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
          return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }
        let payload: unknown;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        try {
          const result = await ingestMetaMessageAttributionWebhook({ payload, rawBody });
          // Durable insert is complete before acknowledgement. Enrichment is
          // deliberately detached so Graph/Chatwoot latency cannot delay Meta.
          setImmediate(() => {
            void processPendingMetaAttributionEvents().catch((error) =>
              console.error("[meta-attribution] background processing failed", {
                message: error instanceof Error ? error.message.slice(0, 240) : "processing failed",
              }),
            );
          });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[meta-attribution] durable ingestion failed", {
            message: error instanceof Error ? error.message.slice(0, 240) : "ingestion failed",
          });
          return Response.json({ ok: false, error: "Webhook ingestion failed" }, { status: 500 });
        }
      },
    },
  },
});
