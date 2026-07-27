import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/products")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getProductSnapshot, computeProducts, productDetail } =
          await import("@/lib/products.server");
        const { OdooError } = await import("@/lib/odoo.server");
        const { json } = await import("@/lib/api.server");

        const p = new URL(request.url).searchParams;

        try {
          // `fresh=1` bypasses the 60-second cache; the Refresh button uses it.
          const snapshot = await getProductSnapshot(p.get("fresh") === "1");

          const companyId = Number(p.get("company")) || undefined;
          const filters = {
            // `range=all` opts out of the window entirely, matching the other tabs.
            from: p.get("range") === "all" ? undefined : p.get("from") || undefined,
            to: p.get("range") === "all" ? undefined : p.get("to") || undefined,
            basis: p.get("basis") === "invoiced" ? ("invoiced" as const) : ("all" as const),
            companyId: snapshot.health.companies.some((c) => c.id === companyId)
              ? companyId
              : undefined,
            source: p.get("psource") || undefined,
            variant: p.get("variant") || undefined,
            family: p.get("family") || undefined,
          };

          const detailId = Number(p.get("detail")) || 0;

          return json({
            ...computeProducts(snapshot, filters),
            detail: detailId ? productDetail(snapshot, filters, detailId) : null,
            appliedFilters: filters,
          });
        } catch (err) {
          const odoo = err instanceof OdooError ? err : null;
          // 503 for "we can't reach Odoo", 500 for anything genuinely unexpected.
          return Response.json(
            {
              error: odoo?.message ?? (err instanceof Error ? err.message : "Unknown error"),
              kind: odoo?.kind ?? "server",
            },
            {
              status: odoo && odoo.kind !== "server" ? 503 : 500,
              headers: { "cache-control": "no-store" },
            },
          );
        }
      },
    },
  },
});
