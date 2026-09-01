import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  mappings: z
    .array(
      z.object({
        priceItemId: z.string().uuid(),
        odooProductId: z.number().int().positive(),
        odooProductCode: z.string().max(80).default(""),
        matchType: z.enum(["manual", "alias"]).default("manual"),
        confidence: z.number().min(0).max(1).default(1),
      }),
    )
    .min(1)
    .max(500)
    .optional(),
  paymentAliases: z
    .array(
      z.object({
        alias: z.string().trim().min(1).max(120),
        method: z.enum(["tabby", "tamara", "cash", "cashier", "bank_transfer", "unknown"]),
      }),
    )
    .max(200)
    .optional(),
});

/**
 * Approve a product link, or teach the reader a payment-journal name.
 *
 * Both are the manual half of the matching order: a line that cannot be matched
 * by Odoo product id or exact code is never guessed at, it waits here until a
 * person says what it is.
 */
export const Route = createFileRoute("/api/pricing/mappings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState } = await import("@/lib/pricing/pricing-api.server");
        const { listProductMappings, listPaymentAliases, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");
        const { DEFAULT_PAYMENT_ALIASES } = await import("@/lib/pricing/pricing-normalize");

        if (!pricingDatabaseConfigured()) {
          return json({
            configured: false,
            mappings: [],
            paymentAliases: {},
            defaultAliases: DEFAULT_PAYMENT_ALIASES,
            auth: authState(request),
            error: "",
          });
        }
        try {
          const [mappings, paymentAliases] = await Promise.all([
            listProductMappings(),
            listPaymentAliases(),
          ]);
          return json({
            configured: true,
            mappings,
            paymentAliases,
            defaultAliases: DEFAULT_PAYMENT_ALIASES,
            auth: authState(request),
            error: "",
          });
        } catch (error) {
          return json({
            configured: true,
            mappings: [],
            paymentAliases: {},
            defaultAliases: DEFAULT_PAYMENT_ALIASES,
            auth: authState(request),
            error: error instanceof Error ? error.message : "Mappings could not be read.",
          });
        }
      },

      POST: async ({ request }) => {
        const { guard, body, json, fail } = await import("@/lib/pricing/pricing-api.server");
        const authorized = guard(request);
        if (!authorized.ok) return authorized.response;
        const parsed = await body(request, schema);
        if (!parsed.ok) return parsed.response;
        if (!parsed.data.mappings?.length && !parsed.data.paymentAliases?.length) {
          return fail("Nothing to save.");
        }

        try {
          const { upsertProductMappings, upsertPaymentAliases } =
            await import("@/lib/pricing/pricing-db.server");
          const { invalidateComplianceCache } = await import("@/lib/pricing/compliance.server");

          const products = parsed.data.mappings?.length
            ? await upsertProductMappings(
                parsed.data.mappings.map((mapping) => ({
                  ...mapping,
                  approvedBy: authorized.label,
                })),
                authorized.label,
              )
            : 0;
          const aliases = parsed.data.paymentAliases?.length
            ? await upsertPaymentAliases(parsed.data.paymentAliases, authorized.label)
            : 0;

          invalidateComplianceCache();
          return json({
            ok: true,
            mappings: products,
            paymentAliases: aliases,
            // Both change how lines are judged, so the stored verdicts are now
            // stale until the audit is re-run.
            recalculationRequired: true,
            by: authorized.actor.name || authorized.actor.id,
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Saving the mapping failed.");
        }
      },
    },
  },
});
