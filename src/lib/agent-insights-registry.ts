/**
 * Every analytical surface the dashboard shows, and how an agent reaches it.
 *
 * WHY THIS EXISTS. ENGO Nexus could reach seven of the sixteen visible
 * surfaces. Asked "الويبسايت باع بكام؟" it answered that it did not have the
 * data — while /website was showing the figure. That is not a data gap, it is
 * an unwired capability, and the two are indistinguishable to a user.
 *
 * THIS FILE IS NOW A PROJECTION, NOT A SOURCE. The authoritative declaration
 * lives in `agent-surface-contract.ts`, which carries the per-view sources,
 * required arguments, row projections and caveats the gateway actually needs.
 * This module keeps the flatter shape the existing coverage tests and the
 * older callers read, derived from that one contract — so a surface cannot be
 * described two different ways in two files, which is how `endpoints[0]`
 * survived: the registry listed three endpoints and the gateway used one, and
 * nothing compared them.
 *
 * It contains no figures and performs no computation — the endpoints it names
 * are the dashboard's own, so the agent and the page cannot diverge.
 */

import {
  SURFACE_CONTRACTS,
  AGENT_FORBIDDEN_ENDPOINTS as CONTRACT_FORBIDDEN,
  type SurfaceContract,
} from "./agent-surface-contract";

export type { SurfaceStatus, SurfaceOperation } from "./agent-surface-contract";
import type { SurfaceStatus, SurfaceOperation } from "./agent-surface-contract";

export interface InsightsSurface {
  /** Stable id used by the agent tool. Never a URL. */
  id: string;
  /** Routes that resolve to this surface, including legacy aliases. */
  routes: string[];
  /** Navigation section this surface belongs to. */
  section: string;
  /** Internal analytical views the page switches between, if any. */
  views: string[];
  /**
   * Every dashboard endpoint that supplies it — all of them, not the first.
   *
   * The gateway now reads the contract's per-view source list rather than this
   * array. It stays here because the coverage audit and the route-file test
   * both walk it, and because "which endpoints does this surface touch" is a
   * question worth being able to ask in one line.
   */
  endpoints: string[];
  /** What an agent may ask of it. */
  operations: SurfaceOperation[];
  /** Entity kinds selectable on this surface. */
  entities: string[];
  /** True when the surface can expose personal data and needs care. */
  sensitive: boolean;
  status: SurfaceStatus;
  /** Where this surface keeps its headline figures, as dot paths. */
  summaryPaths?: string[];
  /** Why, when the status is not CONNECTED. */
  note?: string;
}

const project = (contract: SurfaceContract): InsightsSurface => ({
  id: contract.id,
  routes: [...contract.routes],
  section: contract.section,
  views: contract.views.map((view) => view.id),
  endpoints: contract.sources.map((source) => source.endpoint),
  operations: [...contract.operations],
  entities: [...contract.entities],
  sensitive: contract.sensitivity === "personal",
  status: contract.status,
  summaryPaths: [
    ...new Set([
      ...(contract.summaryPaths ?? []),
      ...contract.sources.flatMap((source) => source.summaryPaths ?? []),
    ]),
  ].sort(),
  ...(contract.note ? { note: contract.note } : {}),
});

export const INSIGHTS_SURFACES: InsightsSurface[] = SURFACE_CONTRACTS.map(project);

export const AGENT_FORBIDDEN_ENDPOINTS: string[] = [...CONTRACT_FORBIDDEN];

const BY_ROUTE = new Map<string, InsightsSurface>();
for (const surface of INSIGHTS_SURFACES) {
  for (const route of surface.routes) BY_ROUTE.set(route, surface);
}

/** The surface a pathname belongs to, or null. */
export function surfaceForRoute(pathname: string): InsightsSurface | null {
  const normalized = (pathname || "/").toLowerCase().replace(/\/+$/, "") || "/";
  return (
    BY_ROUTE.get(normalized) ??
    INSIGHTS_SURFACES.find((surface) =>
      surface.routes.some((route) => route !== "/" && normalized.startsWith(`${route}/`)),
    ) ??
    null
  );
}

export const surfaceById = (id: string): InsightsSurface | null =>
  INSIGHTS_SURFACES.find((surface) => surface.id === id) ?? null;

/** Surfaces an agent may actually read. */
export const AGENT_READABLE_SURFACES = INSIGHTS_SURFACES.filter(
  (surface) => surface.status === "CONNECTED" || surface.status === "PARTIAL",
);
