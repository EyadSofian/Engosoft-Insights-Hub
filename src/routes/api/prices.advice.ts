import { createFileRoute } from "@tanstack/react-router";

/**
 * What a seller should quote for one course, on one payment route.
 *
 * The question the price advisor answers, asked over HTTP so another Engosoft
 * app can put the answer in front of its own users without shipping a second
 * copy of the pricing rule. Both readings — this response and the advisor tab —
 * come out of `@/lib/pricing/price-advice`, so a workspace module and this
 * dashboard can never quote different numbers for the same sale.
 *
 * Authenticated as a *service*, not as a person: the calling app proves it is
 * itself with `X-Service-Secret` and decides for itself which of its users may
 * ask. Signed-in browsers on this deployment do not need it — the advisor tab
 * already holds the catalogue it was drawn from.
 *
 *   GET /api/prices/advice?q=CFM&market=sa&payment=cash&state=discount
 *   GET /api/prices/advice?key=<entryKey>&asked=850
 *
 * Naming no course is an error rather than a whole-book dump: this endpoint
 * answers about a sale, and `/api/pricing/catalog` is where the book lives.
 */
export const Route = createFileRoute("/api/prices/advice")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, fail } = await import("@/lib/pricing/pricing-api.server");
        const { authorizeService } = await import("@/lib/admin-auth.server");
        const { buildAdvice, entryKey, parseAsked } = await import("@/lib/pricing/price-advice");
        const { currentPublishedBook, queryPriceItems, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");
        const { groupCatalog } = await import("@/lib/pricing/compliance.server");

        const allowed = authorizeService(request);
        if (!allowed.ok) return json({ ok: false, error: allowed.error }, allowed.status);

        const params = new URL(request.url).searchParams;
        const text = (key: string, max = 160): string =>
          (params.get(key) ?? "").trim().slice(0, max);

        const key = text("key", 320);
        const code = text("code");
        const q = text("q");
        if (!key && !code && !q) {
          return fail("Name a course: pass key, code or q.", 400);
        }

        const market = params.get("market") === "eg" ? "eg" : "sa";
        const payment = params.get("payment") === "cash" ? "cash" : "instalment";
        const stateParam = params.get("state");
        const state =
          stateParam === "discount" || stateParam === "approved_floor" ? stateParam : "standard";
        // Left unset, the scope is worked out rather than assumed. A bundle
        // publishes no individual price, so answering it in course scope always
        // returns "nothing published" — a wrong answer to a question the caller
        // did not ask. An explicit mode is still obeyed exactly.
        const requestedMode = params.get("mode");
        const mode =
          requestedMode === "package" ? "package" : requestedMode === "course" ? "course" : null;

        // An unparseable `asked` is refused rather than quietly read as zero,
        // which would judge a quote nobody made.
        const parsedAsked = parseAsked(text("asked", 24));
        if (!parsedAsked.ok) return fail("asked: must be a number.", 400);
        const asked = parsedAsked.value;

        if (!pricingDatabaseConfigured()) {
          return json({
            ok: false,
            configured: false,
            book: null,
            matches: [],
            advice: null,
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
              matches: [],
              advice: null,
              error: "No price book has been published yet.",
            });
          }

          // A key carries its own product code, so an exact lookup still reads
          // one indexed slice of the book rather than all of it. A key whose
          // code half is empty (an entry identified only by course name) falls
          // back to the caller's search term, and to the whole book if there is
          // none — which is the read the catalogue page already does.
          const keyCode = key ? key.split(":")[0] : "";
          const search = keyCode || code || q;

          const { items } = await queryPriceItems({
            bookId: book.id,
            search: search || undefined,
            activeOnly: true,
            limit: 1000,
          });

          const wanted = code.toLocaleUpperCase("en");
          const entries = groupCatalog(items).filter((entry) => {
            if (key) return entryKey(entry) === key;
            if (code) return entry.code.toLocaleUpperCase("en") === wanted;
            return true;
          });

          const summary = {
            id: book.id,
            name: book.name,
            version: book.version,
            effectiveFrom: book.effectiveFrom,
            effectiveTo: book.effectiveTo,
            baseCurrency: book.baseCurrency,
          };

          // Allowlisted: a grouped entry also carries how much the course sold in
          // the period, and each rule the workbook sheet and row behind it.
          // Neither is part of "what do I quote".
          const matches = entries.slice(0, 20).map((entry) => ({
            key: entryKey(entry),
            code: entry.code,
            courseName: entry.courseName,
            specialization: entry.specialization,
            subcategory: entry.subcategory,
            deliveryType: entry.deliveryType,
            level: entry.level,
            onHold: entry.onHold,
          }));

          // One course means one answer. Several means the caller has to say
          // which, and gets the shortlist to say it with.
          const adviceFor = (entryMode: "course" | "package") =>
            buildAdvice(entries[0], { market, payment, state, asked, mode: entryMode });

          let advice = null;
          if (entries.length === 1) {
            if (mode) advice = adviceFor(mode);
            else {
              const asCourse = adviceFor("course");
              const asPackage = asCourse.band ? null : adviceFor("package");
              // Falls back to the course reading when neither scope publishes
              // anything, so "no price on this route" stays the answer rather
              // than becoming "no package price" for something that is not one.
              advice = asCourse.band ? asCourse : asPackage?.band ? asPackage : asCourse;
            }
          }

          return json({
            ok: true,
            configured: true,
            book: summary,
            matches,
            truncated: entries.length > matches.length,
            advice,
            error: "",
          });
        } catch (error) {
          return json(
            {
              ok: false,
              configured: true,
              book: null,
              matches: [],
              advice: null,
              error: error instanceof Error ? error.message : "The price book could not be read.",
            },
            500,
          );
        }
      },
    },
  },
});
