import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Re-judge every line in the window, not only the ones that changed. */
  force: z.boolean().default(false),
  /** Widen the window to every stored invoice. Deliberately opt-in. */
  allTime: z.boolean().default(false),
  /** Skip the Odoo reads; unseen invoices stay `unknown` this run. */
  offline: z.boolean().default(false),
  /** Also send the digest for anything new this run found. */
  notify: z.boolean().default(false),
});

/**
 * Re-run the audit.
 *
 * A write, not a read: it is the only thing that calls Odoo, and it is never
 * triggered by opening a page. The default window is the last ninety days;
 * `allTime` has to be asked for, because that is the run that costs real money
 * on a metered plan.
 */
export const Route = createFileRoute("/api/pricing/recalculate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { guard, body, json, fail } = await import("@/lib/pricing/pricing-api.server");
        const authorized = guard(request);
        if (!authorized.ok) return authorized.response;
        const parsed = await body(request, schema);
        if (!parsed.ok) return parsed.response;

        try {
          const { runPriceAudit, sendPricingDigest } =
            await import("@/lib/pricing/compliance.server");
          const input = parsed.data;
          const result = await runPriceAudit({
            // "All time" is expressed as a start date the accounting snapshot
            // cannot precede, rather than by removing the window: every query
            // downstream stays bounded.
            from: input.allTime ? "2000-01-01" : input.from,
            to: input.to,
            force: input.force,
            offline: input.offline,
          });

          const digest = input.notify && result.ok ? await sendPricingDigest() : null;
          return json({
            ok: result.ok,
            run: result,
            digest,
            by: authorized.actor.name || authorized.actor.id,
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "The audit run failed.", 500);
        }
      },
    },
  },
});
