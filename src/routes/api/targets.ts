import { createFileRoute } from "@tanstack/react-router";

/**
 * The published quotas, and the endpoint that edits them.
 *
 *   GET  /api/targets?month=YYYY-MM   the roster with its current quotas
 *   POST /api/targets                 save edits for one month  (guarded)
 *
 * Reading is open, like every other report here. Writing requires either a
 * workspace SSO session or the admin code, and is refused outright when neither
 * is configured — see `admin-auth.server.ts`.
 */

/** A whole team's monthly quota list; well above the 30-odd rows in practice. */
const MAX_EDITS = 200;

export const Route = createFileRoute("/api/targets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { loadTargetSource } = await import("@/lib/sales-targets.server");
        const { targetMonths } = await import("@/lib/sales-targets");
        const { writesEnabled, ssoConfigured, adminCodeConfigured, authorizeWrite } =
          await import("@/lib/admin-auth.server");

        const snapshot = await loadTargetSource();
        const months = targetMonths(snapshot.source);
        const requested = new URL(request.url).searchParams.get("month") ?? "";
        const month = months.includes(requested) ? requested : (months.at(-1) ?? "");
        const overridden = new Set(
          snapshot.overrides.filter((row) => row.month === month).map((row) => row.employeeId),
        );
        const guard = authorizeWrite(request);

        return Response.json(
          {
            ok: true,
            month,
            months,
            editable: snapshot.editable && writesEnabled(),
            // So the screen can explain what to configure instead of showing a
            // save button that will always fail.
            auth: {
              signedIn: guard.ok,
              via: guard.ok ? guard.actor.via : null,
              name: guard.ok ? guard.actor.name : "",
              sso: ssoConfigured(),
              adminCode: adminCodeConfigured(),
            },
            storeError: snapshot.error,
            rows: (snapshot.source[month] ?? []).map((entry) => ({
              employeeId: entry.employeeId,
              name: entry.name,
              teamLeader: entry.teamLeader,
              supervisor: entry.supervisor,
              branch: entry.branch,
              target: entry.target,
              note: entry.note,
              source: overridden.has(entry.employeeId) ? "edited" : "published",
            })),
          },
          { headers: { "cache-control": "no-store" } },
        );
      },

      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) {
          return Response.json(
            { ok: false, error: guard.error },
            { status: guard.status, headers: { "cache-control": "no-store" } },
          );
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return Response.json({ ok: false, error: "Invalid payload." }, { status: 400 });
        }

        const body = payload as { month?: unknown; edits?: unknown };
        const month = typeof body.month === "string" ? body.month : "";
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return Response.json({ ok: false, error: "month must be YYYY-MM." }, { status: 400 });
        }
        if (!Array.isArray(body.edits) || body.edits.length === 0) {
          return Response.json(
            { ok: false, error: "edits must be a non-empty array." },
            { status: 400 },
          );
        }
        if (body.edits.length > MAX_EDITS) {
          return Response.json(
            { ok: false, error: `edits must contain at most ${MAX_EDITS} items.` },
            { status: 400 },
          );
        }

        const edits: { employeeId: string; target: number | null; note?: string }[] = [];
        for (const raw of body.edits) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return Response.json(
              { ok: false, error: "Every edit must be an object." },
              { status: 400 },
            );
          }
          const edit = raw as { employeeId?: unknown; target?: unknown; note?: unknown };
          const employeeId = typeof edit.employeeId === "string" ? edit.employeeId.trim() : "";
          if (!employeeId) {
            return Response.json(
              { ok: false, error: "Every edit needs an employeeId." },
              { status: 400 },
            );
          }
          // `null` is a real, distinct value here: "publishes no quota", which
          // is not zero. Only an absent or non-numeric target maps to it.
          let target: number | null = null;
          if (edit.target !== null && edit.target !== undefined && edit.target !== "") {
            const parsed = Number(edit.target);
            if (!Number.isFinite(parsed) || parsed < 0) {
              return Response.json(
                {
                  ok: false,
                  error: `Target for ${employeeId} must be a positive number or empty.`,
                },
                { status: 400 },
              );
            }
            target = parsed;
          }
          edits.push({
            employeeId,
            target,
            note: typeof edit.note === "string" ? edit.note.slice(0, 200) : undefined,
          });
        }

        try {
          const { saveTargetOverrides } = await import("@/lib/sales-targets.server");
          const result = await saveTargetOverrides(
            month,
            edits,
            guard.actor.email || guard.actor.name || guard.actor.id,
          );
          // The employee report caches its own snapshot; drop it so the new
          // quota shows on the next load instead of up to five minutes later.
          const { invalidateDataCache } = await import("@/lib/sheet-cache.server");
          invalidateDataCache();
          return Response.json(
            { ok: true, ...result, savedBy: guard.actor.name || guard.actor.id },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          return Response.json(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Saving the targets failed.",
            },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
