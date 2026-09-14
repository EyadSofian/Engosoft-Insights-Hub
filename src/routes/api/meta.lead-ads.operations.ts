import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

const PAGE_OR_FORM_ID = /^\d{5,32}$/;

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.map((item) => String(item).trim()).filter((item) => PAGE_OR_FORM_ID.test(item)),
        ),
      ]
    : [];
}

/**
 * Admin-only Lead Ads operations: health, form inventory, Page subscription and
 * backfill. Every mutating action is a dry run unless `dryRun: false` is sent.
 */
export const Route = createFileRoute("/api/meta/lead-ads/operations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);
        const { getMetaLeadAdsHealth } = await import("@/lib/meta-leadgen.server");
        return json(await getMetaLeadAdsHealth());
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "Body must be JSON" }, 400);
        }
        const dryRun = body.dryRun !== false;
        const server = await import("@/lib/meta-leadgen.server");
        switch (body.action) {
          case "list_forms":
            return json(await server.listMetaLeadForms(ids(body.pageIds)));
          case "subscribe_pages":
            return json(await server.subscribeMetaLeadgenPages(ids(body.pageIds), { dryRun }));
          case "backfill": {
            const maxLeadsPerForm = Number(body.maxLeadsPerForm);
            return json(
              await server.backfillMetaLeads({
                formIds: ids(body.formIds),
                dryRun,
                restart: body.restart === true,
                maxLeadsPerForm:
                  Number.isFinite(maxLeadsPerForm) && maxLeadsPerForm > 0
                    ? maxLeadsPerForm
                    : undefined,
              }),
            );
          }
          case "process_pending":
            return json(await server.processPendingMetaLeadgenEvents());
          default:
            return json({ error: "Unknown action" }, 400);
        }
      },
    },
  },
});
