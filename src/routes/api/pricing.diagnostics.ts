import { createFileRoute } from "@tanstack/react-router";

/**
 * What this Odoo actually exposes for payments, and how far the audit has run.
 *
 * Exists so the payment path can be verified on the deployed app rather than
 * argued about: it reports the field names it found and the ones it wanted,
 * never a credential, a URL, a database name or a value.
 */
export const Route = createFileRoute("/api/pricing/diagnostics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState } = await import("@/lib/pricing/pricing-api.server");
        const { pricingDatabaseConfigured, readAuditState, currentPublishedBook } =
          await import("@/lib/pricing/pricing-db.server");
        const { odooConfigured } = await import("@/lib/odoo.server");

        const auth = authState(request);
        const wantsOdoo = new URL(request.url).searchParams.get("odoo") === "1";

        // The field probe is three `fields_get` calls. It runs only when asked
        // for, so a page that polls this endpoint cannot turn into Odoo traffic.
        const fields =
          wantsOdoo && auth.signedIn
            ? await (await import("@/lib/pricing/payment-methods.server")).describePaymentFields()
            : null;

        let state = null;
        let book = null;
        let accounting = null;
        if (pricingDatabaseConfigured()) {
          try {
            const { accountingReadiness } = await import("@/lib/pricing/compliance.server");
            [state, book, accounting] = await Promise.all([
              readAuditState(),
              currentPublishedBook(),
              accountingReadiness(),
            ]);
          } catch {
            // Diagnostics must not be the thing that breaks.
          }
        }

        return json({
          database: pricingDatabaseConfigured(),
          odoo: odooConfigured(),
          auth,
          book,
          state,
          accounting,
          paymentFields: fields,
          hint: wantsOdoo && !auth.signedIn ? "Sign in to probe the Odoo payment schema." : "",
        });
      },
    },
  },
});
