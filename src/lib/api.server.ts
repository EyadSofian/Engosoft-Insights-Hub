// Server-only helpers shared by every /api route.
import type { GlobalFilters, Platform } from "./types";
import { getDefaultRange } from "./metrics.server";

/**
 * Reads filters off the query string. With no explicit window the range falls
 * back to year-to-date — ad spend now covers the whole year, so the old
 * Meta-window default (and the period-mismatch warning it needed) is gone.
 * `range=all` opts out.
 */
export async function parseFilters(request: Request): Promise<GlobalFilters> {
  const p = new URL(request.url).searchParams;
  const explicitAll = p.get("range") === "all";
  const platform = p.get("platform");

  const filters: GlobalFilters = {
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    platform: platform === "meta" || platform === "snapchat" ? (platform as Platform) : undefined,
    account: p.get("account") || undefined,
    campaign: p.get("campaign") || undefined,
    adset: p.get("adset") || undefined,
    ad: p.get("ad") || undefined,
    source: p.get("source") || undefined,
    course: p.get("course") || undefined,
    mainCategory: p.get("mainCategory") || undefined,
    salesTeam: p.get("salesTeam") || undefined,
    salesperson: p.get("salesperson") || undefined,
    includeNonLead: p.get("includeNonLead") === "1" ? "1" : undefined,
    cpaBasis: p.get("cpaBasis") === "invoices" ? "invoices" : undefined,
  };

  if (explicitAll) {
    filters.range = "all";
  } else if (!filters.from && !filters.to) {
    const d = await getDefaultRange();
    if (d.from) filters.from = d.from;
    if (d.to) filters.to = d.to;
  }
  return filters;
}

export function json(data: unknown): Response {
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}

/** Detail endpoints cap payload size so a page can't ship 18k rows to a phone. */
export const ROW_CAP = 3000;

export function capped<T>(rows: T[], cap = ROW_CAP): { rows: T[]; total: number; truncated: boolean } {
  return { rows: rows.slice(0, cap), total: rows.length, truncated: rows.length > cap };
}
