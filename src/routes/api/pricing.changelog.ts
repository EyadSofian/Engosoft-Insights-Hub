import { createFileRoute } from "@tanstack/react-router";

/** Who changed which price, when, and why. */
export const Route = createFileRoute("/api/pricing/changelog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState } = await import("@/lib/pricing/pricing-api.server");
        const { listChangeLog, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");

        if (!pricingDatabaseConfigured()) {
          return json({ configured: false, entries: [], auth: authState(request), error: "" });
        }
        try {
          const params = new URL(request.url).searchParams;
          const entries = await listChangeLog({
            bookId: params.get("bookId")?.trim() || undefined,
            itemId: params.get("itemId")?.trim() || undefined,
            limit: Math.min(Math.max(Number(params.get("limit")) || 100, 1), 500),
          });
          return json({ configured: true, entries, auth: authState(request), error: "" });
        } catch (error) {
          return json({
            configured: true,
            entries: [],
            auth: authState(request),
            error: error instanceof Error ? error.message : "The change log could not be read.",
          });
        }
      },
    },
  },
});
