import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

const MAX_ROWS_PER_REQUEST = 2_000;

function authorized(request: Request): boolean {
  const expected = process.env.DASHBOARD_INGEST_SECRET?.trim() ?? "";
  if (!expected) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const supplied = request.headers.get("x-ingest-secret")?.trim() || bearer.trim();
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute("/api/ingest/dataset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!process.env.DATABASE_URL?.trim() || !process.env.DASHBOARD_INGEST_SECRET?.trim()) {
          return Response.json(
            { ok: false, error: "Dashboard ingestion is not configured." },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
        if (!authorized(request)) {
          return Response.json(
            { ok: false, error: "Unauthorized." },
            { status: 401, headers: { "cache-control": "no-store" } },
          );
        }
        const dataset = new URL(request.url).searchParams.get("dataset");
        const { isDashboardDataset, readDashboardDataset } =
          await import("@/lib/dashboard-db.server");
        if (!isDashboardDataset(dataset)) {
          return Response.json({ ok: false, error: "Unknown dataset." }, { status: 400 });
        }
        // Workers only need the small PBX directory to attach an extension to
        // an Odoo user. Large reporting datasets are deliberately write-only.
        if (dataset !== "pbx_extensions") {
          return Response.json({ ok: false, error: "Dataset is not readable here." }, { status: 403 });
        }
        try {
          const snapshot = await readDashboardDataset(dataset);
          return Response.json(
            {
              ok: true,
              dataset,
              rows: snapshot.rows,
              rowCount: snapshot.rowCount,
              syncedAt: snapshot.syncedAt,
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return Response.json(
            { ok: false, error: "Dataset read failed." },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
      POST: async ({ request }) => {
        if (!process.env.DATABASE_URL?.trim() || !process.env.DASHBOARD_INGEST_SECRET?.trim()) {
          return Response.json(
            { ok: false, error: "Dashboard ingestion is not configured." },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
        if (!authorized(request)) {
          return Response.json(
            { ok: false, error: "Unauthorized." },
            { status: 401, headers: { "cache-control": "no-store" } },
          );
        }
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > 10 * 1024 * 1024) {
          return Response.json({ ok: false, error: "Request is too large." }, { status: 413 });
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
        const body = payload as Record<string, unknown>;
        const { isDashboardDataset, writeDashboardDataset } =
          await import("@/lib/dashboard-db.server");
        if (!isDashboardDataset(body.dataset)) {
          return Response.json({ ok: false, error: "Unknown dataset." }, { status: 400 });
        }
        if (!Array.isArray(body.rows) || body.rows.length > MAX_ROWS_PER_REQUEST) {
          return Response.json(
            { ok: false, error: `rows must contain at most ${MAX_ROWS_PER_REQUEST} items.` },
            { status: 400 },
          );
        }
        if (body.rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
          return Response.json(
            { ok: false, error: "Every row must be an object." },
            { status: 400 },
          );
        }
        const mode = body.mode === "replace" ? "replace" : "upsert";
        const metadata =
          body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? (body.metadata as Record<string, unknown>)
            : {};
        try {
          const result = await writeDashboardDataset(
            body.dataset,
            body.rows as Record<string, unknown>[],
            {
              mode,
              syncedAt: typeof body.syncedAt === "string" ? body.syncedAt : undefined,
              metadata,
            },
          );
          const { invalidateDataCache } = await import("@/lib/sheet-cache.server");
          invalidateDataCache();
          return Response.json(
            { ok: true, ...result },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return Response.json(
            { ok: false, error: "Dataset write failed." },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
