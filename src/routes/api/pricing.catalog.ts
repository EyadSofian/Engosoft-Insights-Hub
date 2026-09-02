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
        const {
          catalogDemand,
          currentPublishedBook,
          getPriceBook,
          queryPriceItems,
          pricingDatabaseConfigured,
        } = await import("@/lib/pricing/pricing-db.server");
        const { groupCatalog } = await import("@/lib/pricing/compliance.server");
        const { normalizeDemandKey } = await import("@/lib/pricing/catalog-demand");
        const { listTrainingPackages } = await import("@/lib/pricing/packages.server");

        const params = new URL(request.url).searchParams;
        const auth = authState(request);
        if (!pricingDatabaseConfigured()) {
          return json({
            configured: false,
            book: null,
            entries: [],
            packages: [],
            packagesError: "",
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
              packages: [],
              packagesError: "",
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
          const dateBasis = params.get("dateBasis");
          const demandQuery = {
            from: value("from"),
            to: value("to"),
            dateBasis: (dateBasis === "sale" || dateBasis === "invoice" ? dateBasis : "payment") as
              "payment" | "sale" | "invoice",
          };
          const packageRead = listTrainingPackages()
            .then((packages) => ({ packages, error: "" }))
            .catch(() => ({
              packages: [],
              error: "Odoo package prices are temporarily unavailable.",
            }));
          const [{ items, total }, demand, packageResult] = await Promise.all([
            queryPriceItems({
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
              // A course row is up to a dozen rules; 1,000 rules covers the
              // current published Engosoft catalogue in one indexed read.
              limit: Math.min(Math.max(Number(params.get("limit")) || 900, 1), 1000),
              offset: Math.max(Number(params.get("offset")) || 0, 0),
            }),
            catalogDemand(demandQuery),
            packageRead,
          ]);

          const courseDemand = new Map(demand.courses.map((row) => [row.key, row]));
          const entries = groupCatalog(items)
            .map((entry) => ({
              ...entry,
              demand: courseDemand.get(entry.code.trim().toUpperCase()) ?? { orders: 0, units: 0 },
            }))
            .sort(
              (a, b) =>
                b.demand.orders - a.demand.orders ||
                b.demand.units - a.demand.units ||
                a.courseName.localeCompare(b.courseName),
            );

          const packageDemand = new Map(demand.packages.map((row) => [row.key, row]));
          const packageQuery = value("q")?.toLocaleLowerCase("en");
          const packageSpecialization = value("specialization");
          const packageCurrency = value("currency");
          const packageDelivery = value("deliveryType");
          const packages = packageResult.packages
            .filter(
              (item) =>
                (!packageQuery || item.name.toLocaleLowerCase("en").includes(packageQuery)) &&
                (!packageSpecialization || item.specialization === packageSpecialization) &&
                (!packageCurrency || item.currency === packageCurrency) &&
                (!packageDelivery ||
                  (packageDelivery === "recorded"
                    ? item.recordedCourseCount > 0
                    : packageDelivery === "online" || packageDelivery === "offline"
                      ? item.attendanceCourseCount > 0
                      : false)),
            )
            .map((item) => ({
              ...item,
              demand: packageDemand.get(normalizeDemandKey(item.name)) ?? { orders: 0, units: 0 },
            }))
            .sort(
              (a, b) =>
                b.demand.orders - a.demand.orders ||
                b.demand.units - a.demand.units ||
                a.name.localeCompare(b.name),
            );
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
            packages: liveOnly ? [] : packages,
            packagesError: packageResult.error,
            demandPeriod: demandQuery,
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
            packages: [],
            packagesError: "",
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
