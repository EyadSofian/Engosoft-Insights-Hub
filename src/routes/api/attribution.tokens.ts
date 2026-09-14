import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json } from "@/lib/api.server";

const MAX_BODY_BYTES = 8_192;
const text = z.string().trim().max(512).optional();
const tokenSchema = z
  .object({
    source: text,
    medium: text,
    platform: text,
    utmSource: text,
    utmMedium: text,
    utmCampaign: text,
    utmContent: text,
    utmTerm: text,
    referrer: z.string().trim().url().max(1_000).optional(),
    branchId: text,
    branchName: text,
  })
  .strict();

/**
 * Issues a short-lived marker for a website's `wa.me` prefilled message.
 * This is a protected admin/SSO write because an unauthenticated token issuer
 * would let an attacker manufacture attribution evidence.
 */
export const Route = createFileRoute("/api/attribution/tokens")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declared = request.headers.get("content-length");
        if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
          return json({ ok: false, error: "Request is too large." }, 413);
        }
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const authorized = authorizeWrite(request);
        if (!authorized.ok) return json({ ok: false, error: authorized.error }, authorized.status);
        let body: unknown;
        try {
          const raw = await request.text();
          if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
            return json({ ok: false, error: "Request is too large." }, 413);
          }
          body = JSON.parse(raw);
        } catch {
          return json({ ok: false, error: "Invalid JSON body." }, 400);
        }
        const parsed = tokenSchema.safeParse(body);
        if (!parsed.success)
          return json({ ok: false, error: "Invalid attribution token input." }, 400);
        try {
          const { createAttributionTrackingToken } =
            await import("@/lib/chatwoot-attribution.server");
          const issued = await createAttributionTrackingToken(parsed.data);
          return json({ ok: true, ...issued, marker: `[ref:${issued.token}]` });
        } catch (error) {
          return json(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Tracking token could not be issued.",
            },
            503,
          );
        }
      },
    },
  },
});
