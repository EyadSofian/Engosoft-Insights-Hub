import { createFileRoute } from "@tanstack/react-router";

/**
 * Manual lead QA verdicts.
 *
 *   GET  /api/lead-qa?ids=1,2,3        current verdicts for up to 500 CRM leads
 *   GET  /api/lead-qa?history=123      the audit trail of one lead
 *   POST /api/lead-qa                  save one verdict (guarded, like targets)
 *
 * A verdict is stored with the evidence the reviewer was looking at. It never
 * changes the Odoo stage and it is not the AI call-quality score. The tables
 * come from the explicit migration (`npm run migrate:lead-qa`, also run at
 * server start); this route refuses rather than creating them.
 */
const MAX_IDS = 500;

export const Route = createFileRoute("/api/lead-qa")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const {
          LeadQaSchemaMissingError,
          leadQaConfigured,
          readLeadQaVerifications,
          readLeadQaHistory,
        } = await import("@/lib/lead-qa.server");
        const { writesEnabled, authorizeWrite } = await import("@/lib/admin-auth.server");
        if (!leadQaConfigured()) return json({ ok: true, configured: false, verifications: {} });
        try {
          const params = new URL(request.url).searchParams;
          const history = (params.get("history") || "").trim();
          if (history) {
            if (!/^\d{1,12}$/.test(history))
              return Response.json({ error: "history must be a CRM lead id" }, { status: 400 });
            return json({
              ok: true,
              configured: true,
              crmLeadId: history,
              events: await readLeadQaHistory(history),
            });
          }
          const ids = (params.get("ids") || "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
          if (ids.length > MAX_IDS)
            return Response.json({ error: `At most ${MAX_IDS} ids per request` }, { status: 400 });
          const verifications = await readLeadQaVerifications(ids);
          const guard = authorizeWrite(request);
          return json({
            ok: true,
            configured: true,
            schemaReady: true,
            editable: writesEnabled(),
            signedIn: guard.ok,
            verifications: Object.fromEntries(verifications),
          });
        } catch (error) {
          if (error instanceof LeadQaSchemaMissingError)
            return Response.json(
              { ok: false, configured: true, schemaReady: false, error: error.message },
              { status: 503 },
            );
          throw error;
        }
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });
        const { LeadQaSchemaMissingError, leadQaConfigured, upsertLeadQaVerification } =
          await import("@/lib/lead-qa.server");
        if (!leadQaConfigured())
          return Response.json({ error: "Lead QA needs DATABASE_URL" }, { status: 503 });
        const { validateLeadQaInput } = await import("@/lib/lead-qa");
        const body = await request.json().catch(() => null);
        const parsed = validateLeadQaInput(body);
        if (!parsed.ok) return Response.json({ error: parsed.errors.join("; ") }, { status: 400 });
        try {
          const saved = await upsertLeadQaVerification(parsed.value, {
            name: guard.actor.name || guard.actor.email || guard.actor.id,
            via: guard.actor.via,
          });
          return Response.json(
            { ok: true, verification: saved },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          if (error instanceof LeadQaSchemaMissingError)
            return Response.json({ error: error.message, schemaReady: false }, { status: 503 });
          throw error;
        }
      },
    },
  },
});
