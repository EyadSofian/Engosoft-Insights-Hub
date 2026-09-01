import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal("")),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal("")),
  taxInclusive: z.boolean().default(true),
  baseCurrency: z.string().trim().max(8).default("SAR"),
  notes: z.string().trim().max(2000).default(""),
  /** When set, the new draft starts as a copy of this book. */
  copyFromId: z.string().uuid().optional(),
});

/**
 * List the books, and create a new draft.
 *
 * Creating from a copy is how "next month, starting from last month" works: the
 * source book stays published and untouched, and the copy is a separate draft
 * with its own version number.
 */
export const Route = createFileRoute("/api/pricing/books")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState } = await import("@/lib/pricing/pricing-api.server");
        const { listPriceBooks, pricingDatabaseConfigured, readAuditState } =
          await import("@/lib/pricing/pricing-db.server");
        const auth = authState(request);
        if (!pricingDatabaseConfigured()) {
          return json({
            configured: false,
            books: [],
            auth,
            state: null,
            error: "DATABASE_URL is not configured on this deployment.",
          });
        }
        try {
          const [books, state] = await Promise.all([listPriceBooks(), readAuditState()]);
          return json({ configured: true, books, state, auth, error: "" });
        } catch (error) {
          return json({
            configured: true,
            books: [],
            state: null,
            auth,
            error: error instanceof Error ? error.message : "Price books could not be read.",
          });
        }
      },

      POST: async ({ request }) => {
        const { guard, body, json, fail } = await import("@/lib/pricing/pricing-api.server");
        const authorized = guard(request);
        if (!authorized.ok) return authorized.response;

        const parsed = await body(request, createSchema);
        if (!parsed.ok) return parsed.response;
        const input = parsed.data;

        try {
          const { copyPriceBook, createPriceBook } =
            await import("@/lib/pricing/pricing-db.server");
          const book = input.copyFromId
            ? await copyPriceBook(
                input.copyFromId,
                {
                  name: input.name,
                  effectiveFrom: input.effectiveFrom,
                  effectiveTo: input.effectiveTo,
                  taxInclusive: input.taxInclusive,
                  baseCurrency: input.baseCurrency,
                  notes: input.notes,
                },
                authorized.label,
              )
            : await createPriceBook(
                {
                  name: input.name,
                  effectiveFrom: input.effectiveFrom,
                  effectiveTo: input.effectiveTo,
                  sourceType: "manual",
                  taxInclusive: input.taxInclusive,
                  baseCurrency: input.baseCurrency,
                  notes: input.notes,
                },
                [],
                authorized.label,
              );
          return json({ ok: true, book, createdBy: authorized.actor.name || authorized.actor.id });
        } catch (error) {
          return fail(
            error instanceof Error ? error.message : "The price book could not be created.",
          );
        }
      },
    },
  },
});
