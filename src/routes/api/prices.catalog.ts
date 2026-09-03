import { createFileRoute } from "@tanstack/react-router";

/**
 * The whole published price list, one row per course, priced on every route.
 *
 * `/api/prices/advice` answers about one sale. This answers "what do we charge
 * for everything" — the list a seller scans rather than searches, and the one a
 * manager reads down before a campaign.
 *
 * Same band, same rule: each route here is `bandForRoute` from
 * `@/lib/pricing/price-advice`, the module the advisor tab and the advice
 * endpoint already read. A row in this list and the advice for that same course
 * cannot disagree, because neither computes anything the other does not.
 *
 * Service-authenticated like its sibling, and projected field by field: the
 * grouped catalogue also carries how much each course sold and the workbook
 * sheet and row behind every rule, and neither is part of "what do we charge".
 *
 *   GET /api/prices/catalog?specialization=…&deliveryType=…&negotiable=1
 */
export const Route = createFileRoute("/api/prices/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/pricing/pricing-api.server");
        const { authorizeService } = await import("@/lib/admin-auth.server");
        const { bandForRoute, activeOffers, entryKey, isNegotiable, methodsFor, currencyFor } =
          await import("@/lib/pricing/price-advice");
        const { currentPublishedBook, queryPriceItems, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");
        const { groupCatalog } = await import("@/lib/pricing/compliance.server");

        const allowed = authorizeService(request);
        if (!allowed.ok) return json({ ok: false, error: allowed.error }, allowed.status);

        const params = new URL(request.url).searchParams;
        const text = (key: string): string => (params.get(key) ?? "").trim().slice(0, 120);
        const flag = (key: string) => params.get(key) === "1";

        const q = text("q");
        const specialization = text("specialization");
        const deliveryType = text("deliveryType");
        const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 1000);
        const offset = Math.max(Number(params.get("offset")) || 0, 0);

        if (!pricingDatabaseConfigured()) {
          return json({
            ok: false,
            configured: false,
            book: null,
            courses: [],
            facets: { specializations: [], deliveryTypes: [] },
            total: 0,
            error: "DATABASE_URL is not configured on this deployment.",
          });
        }

        try {
          const book = await currentPublishedBook();
          if (!book) {
            return json({
              ok: false,
              configured: true,
              book: null,
              courses: [],
              facets: { specializations: [], deliveryTypes: [] },
              total: 0,
              error: "No price book has been published yet.",
            });
          }

          const { items } = await queryPriceItems({
            bookId: book.id,
            search: q || undefined,
            specialization: specialization || undefined,
            deliveryType: deliveryType || undefined,
            activeOnly: true,
            limit: 1000,
          });

          const grouped = groupCatalog(items);

          // Facets come from the whole matched set, not the page, so narrowing by
          // one filter never empties the dropdown for the other.
          const facets = {
            specializations: [
              ...new Set(grouped.map((e) => e.specialization).filter(Boolean)),
            ].sort(),
            deliveryTypes: [...new Set(grouped.map((e) => e.deliveryType).filter(Boolean))].sort(),
          };

          const priced = grouped.map((entry) => {
            // A bundle publishes no individual price. Reading the scope that the
            // entry actually uses is what keeps a package out of the "no price"
            // bucket — the same choice `/advice` makes.
            const asCourse = {
              sa_cash: bandForRoute(entry, "sa", "cash") ?? null,
              sa_instalment: bandForRoute(entry, "sa", "instalment") ?? null,
              eg: bandForRoute(entry, "eg", "cash") ?? null,
            };
            const hasCourseBand = Object.values(asCourse).some(Boolean);
            const routes = hasCourseBand
              ? asCourse
              : {
                  sa_cash: bandForRoute(entry, "sa", "cash", "package") ?? null,
                  sa_instalment: bandForRoute(entry, "sa", "instalment", "package") ?? null,
                  eg: bandForRoute(entry, "eg", "cash", "package") ?? null,
                };
            const mode = hasCourseBand ? "course" : "package";
            const live = activeOffers(entry);
            const offers = live.map((price) => ({
              id: price.id,
              currency: price.currency,
              paymentMethod: price.paymentMethod,
              exact: price.exact,
              minimum: price.minimum,
              maximum: price.maximum,
              validFrom: price.validFrom,
              validTo: price.validTo,
              note: price.note,
            }));

            /**
             * The same offers, bucketed by the route they apply to.
             *
             * A course whose only published price is an offer has no band on any
             * route, and a list that only knows about bands draws it as a row of
             * dashes — "no price" for something being actively sold. Bucketed
             * here rather than in the reader, because which methods a route
             * covers is `methodsFor`, and that answer already lives in the rule.
             */
            const forRoute = (market: "sa" | "eg", payment: "cash" | "instalment") => {
              const currency = currencyFor(market);
              const methods = methodsFor(market, payment);
              const seen = new Set<string>();
              return (
                offers
                  .filter(
                    (offer) =>
                      offer.currency === currency &&
                      (market === "eg" ||
                        offer.paymentMethod === "any" ||
                        methods.includes(offer.paymentMethod)),
                  )
                  // Two instruments publishing the same figure are one offer to a
                  // seller; the rows are genuinely two rules, the price is one.
                  .filter((offer) => {
                    const key = `${offer.exact}|${offer.minimum}|${offer.maximum}|${offer.validTo}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  })
              );
            };
            const offersByRoute = {
              sa_cash: forRoute("sa", "cash"),
              sa_instalment: forRoute("sa", "instalment"),
              eg: forRoute("eg", "cash"),
            };

            return {
              key: entryKey(entry),
              code: entry.code,
              rawCode: entry.rawCode,
              courseName: entry.courseName,
              specialization: entry.specialization,
              subcategory: entry.subcategory,
              deliveryType: entry.deliveryType,
              level: entry.level,
              onHold: entry.onHold,
              requiresReview: entry.requiresReview,
              negotiable: isNegotiable(entry),
              mode,
              routes,
              offers,
              offersByRoute,
              /** Nothing published on any route: the row a manager needs to see. */
              unpriced: !Object.values(routes).some(Boolean) && offers.length === 0,
            };
          });

          const filtered = priced.filter((row) => {
            if (flag("negotiable") && !row.negotiable) return false;
            if (flag("offers") && row.offers.length === 0) return false;
            if (flag("unpriced") && !row.unpriced) return false;
            if (flag("hideOnHold") && row.onHold) return false;
            return true;
          });

          // Unpriced and on-hold rows first: they are the ones somebody has to do
          // something about. The rest alphabetically, so the list is scannable.
          filtered.sort(
            (a, b) =>
              Number(b.unpriced) - Number(a.unpriced) ||
              Number(b.requiresReview) - Number(a.requiresReview) ||
              a.courseName.localeCompare(b.courseName),
          );

          return json({
            ok: true,
            configured: true,
            book: {
              id: book.id,
              name: book.name,
              version: book.version,
              effectiveFrom: book.effectiveFrom,
              baseCurrency: book.baseCurrency,
            },
            courses: filtered.slice(offset, offset + limit),
            facets,
            total: filtered.length,
            counts: {
              negotiable: priced.filter((r) => r.negotiable).length,
              withOffers: priced.filter((r) => r.offers.length > 0).length,
              unpriced: priced.filter((r) => r.unpriced).length,
              onHold: priced.filter((r) => r.onHold).length,
            },
            error: "",
          });
        } catch (error) {
          return json(
            {
              ok: false,
              configured: true,
              book: null,
              courses: [],
              facets: { specializations: [], deliveryTypes: [] },
              total: 0,
              error: error instanceof Error ? error.message : "The price book could not be read.",
            },
            500,
          );
        }
      },
    },
  },
});
