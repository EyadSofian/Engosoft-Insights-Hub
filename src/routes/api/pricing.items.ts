import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const price = z.number().finite().min(0).max(10_000_000).nullable();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(""));

const patchSchema = z
  .object({
    exactPrice: price.optional(),
    minimumPrice: price.optional(),
    maximumPrice: price.optional(),
    validFrom: isoDate.optional(),
    validTo: isoDate.optional(),
    active: z.boolean().optional(),
    requiresReview: z.boolean().optional(),
    onHold: z.boolean().optional(),
    note: z.string().max(1000).optional(),
    country: z.string().max(80).optional(),
    company: z.string().max(120).optional(),
    level: z.string().max(80).optional(),
    bundleName: z.string().max(200).optional(),
    paymentMethod: z
      .enum(["tabby", "tamara", "cash", "cashier", "bank_transfer", "any"])
      .optional(),
    currency: z.string().trim().length(3).optional(),
    pricingScope: z.enum(["individual", "bundle", "level", "offer", "incentive"]).optional(),
    courseName: z.string().max(300).optional(),
    specialization: z.string().max(160).optional(),
    subcategory: z.string().max(160).optional(),
    deliveryType: z
      .enum([
        "online",
        "recorded",
        "offline",
        "exam",
        "shipping",
        "certificate",
        "renewal",
        "unknown",
      ])
      .optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "no editable field was supplied" });

const updateSchema = z.object({
  reason: z.string().trim().max(500).default(""),
  updates: z
    .array(z.object({ id: z.string().uuid(), patch: patchSchema }))
    // A bulk edit is a screenful of rows, not a whole book. Anything larger is
    // a copy-and-edit of the book, which has its own endpoint.
    .min(1)
    .max(500),
});

const addSchema = z.object({
  bookId: z.string().uuid(),
  reason: z.string().trim().max(500).default(""),
  item: z.object({
    specialization: z.string().max(160).default(""),
    subcategory: z.string().max(160).default(""),
    rawProductCode: z.string().max(80).default(""),
    courseName: z.string().min(1).max(300),
    deliveryType: z
      .enum([
        "online",
        "recorded",
        "offline",
        "exam",
        "shipping",
        "certificate",
        "renewal",
        "unknown",
      ])
      .default("unknown"),
    level: z.string().max(80).default(""),
    pricingScope: z
      .enum(["individual", "bundle", "level", "offer", "incentive"])
      .default("individual"),
    bundleName: z.string().max(200).default(""),
    paymentMethod: z
      .enum(["tabby", "tamara", "cash", "cashier", "bank_transfer", "any"])
      .default("any"),
    currency: z.string().trim().length(3).default("SAR"),
    exactPrice: price.default(null),
    minimumPrice: price.default(null),
    maximumPrice: price.default(null),
    validFrom: isoDate.default(""),
    validTo: isoDate.default(""),
    country: z.string().max(80).default(""),
    company: z.string().max(120).default(""),
    active: z.boolean().default(true),
    onHold: z.boolean().default(false),
    note: z.string().max(1000).default(""),
  }),
});

/**
 * Read and edit the rows of one book.
 *
 * `PUT` edits existing rows; `POST` adds one. Both refuse on a published book —
 * the store raises rather than writing — because an in-place edit would change
 * what an already-finished audit was judged against.
 */
export const Route = createFileRoute("/api/pricing/items")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState } = await import("@/lib/pricing/pricing-api.server");
        const { currentPublishedBook, getPriceBook, queryPriceItems, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");

        const auth = authState(request);
        if (!pricingDatabaseConfigured()) {
          return json({ configured: false, book: null, items: [], total: 0, auth, error: "" });
        }
        try {
          const params = new URL(request.url).searchParams;
          const requested = params.get("bookId")?.trim();
          const book = requested ? await getPriceBook(requested) : await currentPublishedBook();
          if (!book)
            return json({ configured: true, book: null, items: [], total: 0, auth, error: "" });

          const value = (key: string): string | undefined => {
            const raw = params.get(key)?.trim();
            return raw && raw !== "all" ? raw.slice(0, 120) : undefined;
          };
          const result = await queryPriceItems({
            bookId: book.id,
            search: value("q"),
            specialization: value("specialization"),
            subcategory: value("subcategory"),
            deliveryType: value("deliveryType"),
            paymentMethod: value("paymentMethod"),
            currency: value("currency"),
            scope: value("scope"),
            needsReviewOnly: params.get("needsReview") === "1",
            unmappedOnly: params.get("unmapped") === "1",
            limit: Math.min(Math.max(Number(params.get("limit")) || 100, 1), 500),
            offset: Math.max(Number(params.get("offset")) || 0, 0),
          });
          return json({ configured: true, book, ...result, auth, error: "" });
        } catch (error) {
          return json({
            configured: true,
            book: null,
            items: [],
            total: 0,
            auth,
            error: error instanceof Error ? error.message : "Price rows could not be read.",
          });
        }
      },

      PUT: async ({ request }) => {
        const { guard, body, json, fail } = await import("@/lib/pricing/pricing-api.server");
        const authorized = guard(request);
        if (!authorized.ok) return authorized.response;
        const parsed = await body(request, updateSchema);
        if (!parsed.ok) return parsed.response;

        try {
          const { updatePriceItems } = await import("@/lib/pricing/pricing-db.server");
          const { invalidateComplianceCache } = await import("@/lib/pricing/compliance.server");
          const result = await updatePriceItems(
            parsed.data.updates,
            authorized.label,
            parsed.data.reason,
          );
          invalidateComplianceCache();
          return json({ ok: true, ...result, by: authorized.actor.name || authorized.actor.id });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "The edit could not be saved.");
        }
      },

      POST: async ({ request }) => {
        const { guard, body, json, fail } = await import("@/lib/pricing/pricing-api.server");
        const authorized = guard(request);
        if (!authorized.ok) return authorized.response;
        const parsed = await body(request, addSchema);
        if (!parsed.ok) return parsed.response;

        try {
          const { addPriceItem } = await import("@/lib/pricing/pricing-db.server");
          const { normalizeCourseName, normalizeProductCode } =
            await import("@/lib/pricing/pricing-normalize");
          const { invalidateComplianceCache } = await import("@/lib/pricing/compliance.server");
          const input = parsed.data.item;

          await addPriceItem(
            parsed.data.bookId,
            {
              ...input,
              sourceSheet: "manual",
              sourceRow: 0,
              normalizedProductCode: normalizeProductCode(input.rawProductCode),
              odooProductId: null,
              normalizedCourseName: normalizeCourseName(input.courseName),
              rawDeliveryType: input.deliveryType,
              requiresReview: false,
              rawSourceData: { entered_by: authorized.label },
            },
            authorized.label,
            parsed.data.reason,
          );
          invalidateComplianceCache();
          return json({ ok: true, by: authorized.actor.name || authorized.actor.id });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "The row could not be added.");
        }
      },
    },
  },
});
