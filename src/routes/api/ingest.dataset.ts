import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

// A `replace` has to arrive in one request: splitting it across several would
// delete the earlier chunks and leave an incomplete snapshot. So both limits
// have to clear the largest dataset whole, with room for it to grow.
const MAX_ROWS_PER_REQUEST = 15_000;

/**
 * Largest request body accepted.
 *
 * This was 10 MB, chosen against a comment claiming the payload stayed under
 * it. It did not: Full Invoiced Orders is roughly 6,500 lines and about 26 MB,
 * so on 2026-08-20 the limit rejected nine consecutive syncs with 413 in fifty
 * milliseconds each — the guard meant to stop abuse was stopping the only
 * caller instead.
 *
 * 64 MB is not a measurement of the payload, it is headroom over one: roughly
 * 2.5x the dataset as it stands, so ordinary growth does not walk back into
 * this. The row cap above is the limit with a real basis; this one exists to
 * stop something absurd, and an absurd body is far larger than this.
 */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

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
          return Response.json(
            { ok: false, error: "Dataset is not readable here." },
            { status: 403 },
          );
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
        // `Number(null)` is 0, not NaN, so reading the header without checking
        // for its absence let every chunked upload — which is exactly how a
        // large body arrives — walk past this guard and be buffered whole.
        const declared = request.headers.get("content-length");
        const length = declared === null ? null : Number(declared);
        if (length !== null && Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
          return Response.json({ ok: false, error: "Request is too large." }, { status: 413 });
        }
        let payload: unknown;
        try {
          const { readLimitedJson } = await import("@/lib/limited-json.server");
          payload = await readLimitedJson(request, MAX_REQUEST_BYTES);
        } catch (error) {
          const { RequestBodyTooLargeError } = await import("@/lib/limited-json.server");
          if (error instanceof RequestBodyTooLargeError) {
            return Response.json({ ok: false, error: "Request is too large." }, { status: 413 });
          }
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
        } catch (cause) {
          // Without this the failure is invisible. `dashboard_sync_state` only
          // ever recorded successes, so a dataset failing every half hour sat
          // there reading `success` with a fourteen-hour-old timestamp, and
          // the dashboard reported it as simply "last updated 12:05" — no
          // warning, nothing to notice. Twenty-six consecutive failures went
          // unseen that way.
          const message = cause instanceof Error ? cause.message : "Dataset write failed.";
          const { markDashboardDatasetFailed } = await import("@/lib/dashboard-db.server");
          await markDashboardDatasetFailed(body.dataset, message).catch(() => undefined);
          return Response.json(
            { ok: false, error: "Dataset write failed." },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
