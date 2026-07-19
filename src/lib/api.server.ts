// Server-only helpers shared by every /api route.
import type { GlobalFilters } from "./types";
import { getDefaultRange } from "./metrics.server";

/**
 * Reads filters off the query string. When the caller sends no date window we
 * fall back to the Meta window, so spend and revenue describe the same period
 * and ROAS stays meaningful. `range=all` opts out explicitly.
 */
export async function parseFilters(request: Request): Promise<GlobalFilters> {
  const p = new URL(request.url).searchParams;
  const explicitAll = p.get("range") === "all";

  const filters: GlobalFilters = {
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    account: p.get("account") || undefined,
    campaign: p.get("campaign") || undefined,
    source: p.get("source") || undefined,
    mainCategory: p.get("mainCategory") || undefined,
    salesTeam: p.get("salesTeam") || undefined,
  };

  if (!explicitAll && !filters.from && !filters.to) {
    const d = await getDefaultRange();
    if (d.from) filters.from = d.from;
    if (d.to) filters.to = d.to;
  }
  return filters;
}

export function json(data: unknown): Response {
  return Response.json(data, {
    headers: { "cache-control": "no-store" },
  });
}
