import { createFileRoute } from "@tanstack/react-router";

/** Filter options for the price look-up, taken from the book actually loaded. */
export const Route = createFileRoute("/api/pricing/facets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/pricing/pricing-api.server");
        const { currentPublishedBook, getPriceBook, priceFacets, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");

        if (!pricingDatabaseConfigured()) {
          return json({ configured: false, book: null, facets: null, error: "" });
        }
        try {
          const requested = new URL(request.url).searchParams.get("bookId")?.trim();
          const book = requested ? await getPriceBook(requested) : await currentPublishedBook();
          if (!book) return json({ configured: true, book: null, facets: null, error: "" });
          return json({ configured: true, book, facets: await priceFacets(book.id), error: "" });
        } catch (error) {
          return json({
            configured: true,
            book: null,
            facets: null,
            error: error instanceof Error ? error.message : "Filters could not be read.",
          });
        }
      },
    },
  },
});
