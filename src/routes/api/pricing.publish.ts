import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  bookId: z.string().uuid(),
  action: z.enum(["publish", "rollback", "archive"]).default("publish"),
});

/**
 * Make a draft live, roll back to an earlier version, or archive one.
 *
 * All three go through one atomic transaction in the store, and all three write
 * to the change log. Rollback re-publishes an older book rather than deleting
 * the newer one, so an invoice audited under the newer version can still be
 * traced to the prices it was judged against.
 */
export const Route = createFileRoute("/api/pricing/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { guard, body, json, fail } = await import("@/lib/pricing/pricing-api.server");
        const authorized = guard(request);
        if (!authorized.ok) return authorized.response;

        const parsed = await body(request, schema);
        if (!parsed.ok) return parsed.response;

        try {
          const { publishPriceBook, rollbackToPriceBook, archivePriceBook, getPriceBook } =
            await import("@/lib/pricing/pricing-db.server");
          const { invalidateComplianceCache } = await import("@/lib/pricing/compliance.server");

          const book =
            parsed.data.action === "publish"
              ? await publishPriceBook(parsed.data.bookId, authorized.label)
              : parsed.data.action === "rollback"
                ? await rollbackToPriceBook(parsed.data.bookId, authorized.label)
                : (await archivePriceBook(parsed.data.bookId, authorized.label),
                  await getPriceBook(parsed.data.bookId));

          invalidateComplianceCache();
          return json({
            ok: true,
            book,
            // Prices changed, so the stored verdicts are stale until the audit
            // is re-run. Say so rather than leaving an old number on screen.
            recalculationRequired: parsed.data.action !== "archive",
            by: authorized.actor.name || authorized.actor.id,
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Publishing failed.");
        }
      },
    },
  },
});
