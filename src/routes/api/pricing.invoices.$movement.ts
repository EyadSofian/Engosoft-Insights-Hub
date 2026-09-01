import { createFileRoute } from "@tanstack/react-router";

/**
 * Every audited line on one invoice, with how its payment was read.
 *
 * This is the evidence view behind a finding: a manager who is told a sale was
 * under the floor can see the invoice, the instrument the payment record named,
 * and the rule that was applied — without opening Odoo.
 */
export const Route = createFileRoute("/api/pricing/invoices/$movement")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { json } = await import("@/lib/pricing/pricing-api.server");
        const { complianceRows } = await import("@/lib/pricing/compliance.server");
        const { readStoredPayments, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");

        const movement = decodeURIComponent(
          String((params as { movement?: string }).movement ?? ""),
        ).slice(0, 120);
        if (!movement) return json({ ok: false, error: "No invoice number given." }, 400);
        if (!pricingDatabaseConfigured()) {
          return json({ ok: false, error: "DATABASE_URL is not configured.", lines: [] }, 200);
        }

        try {
          const detail = await complianceRows({ search: movement, limit: 200 });
          const lines = detail.rows.filter((row) => row.invoiceNumber === movement);
          const payments = await readStoredPayments([movement]);
          const { verifyOdooInvoice } = await import("@/lib/pricing/odoo-invoice-reference.server");
          const odoo = await verifyOdooInvoice(
            movement,
            lines.map((line) => line.invoiceLineId),
          );

          return json({
            ok: true,
            invoiceNumber: movement,
            lines,
            payment: payments.get(movement) ?? null,
            // This URL is emitted only after an exact live `account.move` match.
            // Whoever opens it authenticates to Odoo themselves; no credentials
            // are ever included in the response.
            odooRecordUrl: odoo.recordUrl,
            odooVerification: odoo.verification,
            error: detail.error,
          });
        } catch (error) {
          return json(
            {
              ok: false,
              lines: [],
              error: error instanceof Error ? error.message : "The invoice could not be read.",
            },
            200,
          );
        }
      },
    },
  },
});
