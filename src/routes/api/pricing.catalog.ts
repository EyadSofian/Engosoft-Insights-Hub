import { createFileRoute } from "@tanstack/react-router";

/**
 * The price look-up a salesperson uses.
 *
 * Reads the published book out of PostgreSQL. It never touches the Google Sheet
 * or Odoo, so opening the tab costs one indexed query and answers in the same
 * shape whether or not the upstreams happen to be reachable.
 */
export const Route = createFileRoute("/api/pricing/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState } = await import("@/lib/pricing/pricing-api.server");
        const { currentPublishedBook, getPriceBook, queryPriceItems, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");
        const { groupCatalog } = await import("@/lib/pricing/compliance.server");

        const params = new URL(request.url).searchParams;
        const auth = authState(request);
        if (!pricingDatabaseConfigured()) {
          return json({
            configured: false,
            book: null,
            entries: [],
            total: 0,
            auth,
            error: "DATABASE_URL is not configured on this deployment.",
          });
        }

        try {
          const requestedBook = params.get("bookId")?.trim();
          const book = requestedBook
            ? await getPriceBook(requestedBook)
            : await currentPublishedBook();
          if (!book) {
            return json({
              configured: true,
              book: null,
              entries: [],
              total: 0,
              auth,
              error:
                "No price book has been published yet. Import the workbook from the Manage tab and publish it.",
            });
          }

          const value = (key: string): string | undefined => {
            const raw = params.get(key)?.trim();
            return raw && raw !== "all" ? raw.slice(0, 120) : undefined;
          };
          const { items, total } = await queryPriceItems({
            bookId: book.id,
            search: value("q"),
            specialization: value("specialization"),
            subcategory: value("subcategory"),
            deliveryType: value("deliveryType"),
            paymentMethod: value("paymentMethod"),
            currency: value("currency"),
            country: value("country"),
            scope: value("scope"),
            activeOnly: params.get("includeInactive") !== "1",
            needsReviewOnly: params.get("needsReview") === "1",
            // A course card is up to a dozen rules; 900 rules is roughly the
            // 75 cards a page of results shows.
            limit: Math.min(Math.max(Number(params.get("limit")) || 900, 1), 1000),
            offset: Math.max(Number(params.get("offset")) || 0, 0),
          });

          const entries = groupCatalog(items);
          const liveOnly = params.get("liveOffers") === "1";
          const today = new Date().toISOString().slice(0, 10);
          const filtered = liveOnly
            ? entries
                .map((entry) => ({
                  ...entry,
                  prices: entry.prices.filter(
                    (price) =>
                      price.scope !== "offer" ||
                      (price.active &&
                        (!price.validFrom || price.validFrom <= today) &&
                        (!price.validTo || price.validTo >= today)),
                  ),
                }))
                .filter((entry) => entry.prices.some((price) => price.scope === "offer"))
            : entries;

          return json({
            configured: true,
            book,
            entries: filtered,
            total,
            truncated: total > items.length,
            auth,
            error: "",
          });
        } catch (error) {
          return json({
            configured: true,
            book: null,
            entries: [],
            total: 0,
            auth,
            error:
              error instanceof Error ? error.message : "The price catalogue could not be read.",
          });
        }
      },
    },
  },
});
