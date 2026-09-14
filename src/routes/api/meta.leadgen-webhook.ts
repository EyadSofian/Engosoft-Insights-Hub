import { createFileRoute } from "@tanstack/react-router";

const MAX_WEBHOOK_BYTES = 1_000_000;

/**
 * Meta Page `leadgen` webhook for the Engosoft Attribution app.
 *
 * Public by necessity and authenticated by Meta's signature, not by a user
 * session. It never forwards, replies to, or touches the lead itself.
 */
export const Route = createFileRoute("/api/meta/leadgen-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { verifyMetaWebhookChallenge } =
          await import("@/lib/meta-message-attribution.server");
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
        if (Number.isFinite(length) && length > MAX_WEBHOOK_BYTES)
          return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES)
          return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });

        const { verifyMetaWebhookSignature } =
          await import("@/lib/meta-message-attribution.server");
        const appSecret = process.env.META_ATTRIBUTION_APP_SECRET?.trim() || "";
        if (
          !verifyMetaWebhookSignature(
            rawBody,
            request.headers.get("x-hub-signature-256") || "",
            appSecret,
          )
        )
          return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });

        let payload: unknown;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const { ingestMetaLeadgenWebhook, processPendingMetaLeadgenEvents } =
          await import("@/lib/meta-leadgen.server");
        try {
          const result = await ingestMetaLeadgenWebhook({ payload, rawBody });
          // The durable row exists before Meta is acknowledged; enrichment never delays the 200.
          if (result.accepted)
            setImmediate(() => {
              void processPendingMetaLeadgenEvents().catch((error) =>
                console.error("[meta-lead-ads] background processing failed", {
                  message:
                    error instanceof Error ? error.message.slice(0, 200) : "processing failed",
                }),
              );
            });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[meta-lead-ads] durable ingestion failed", {
            message: error instanceof Error ? error.message.slice(0, 200) : "ingestion failed",
          });
          // A non-2xx makes Meta retry, which is what we want when storage is unavailable.
          return Response.json(
            { ok: false, error: "Lead storage is unavailable" },
            { status: 503 },
          );
        }
      },
    },
  },
});
