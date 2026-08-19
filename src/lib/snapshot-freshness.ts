/**
 * When to serve the snapshot already in memory, and when to wait for a new one.
 *
 * The dashboard keeps one in-memory snapshot of every dataset. Rebuilding it is
 * expensive in a way the aggregation on top of it is not: each dataset is stored
 * one `jsonb` row per record and read whole — 18,405 rows and ~28 MB for CRM
 * alone, before the other ten datasets — while the aggregation that follows
 * costs tens of milliseconds.
 *
 * That rebuild used to run inside whichever request first arrived after the TTL
 * expired, so one visitor per five-minute window paid for the whole reload while
 * everyone else was served from memory. That is what "the page hangs sometimes"
 * described: not a slow page, a slow request landing on an unlucky user.
 *
 * Split out of `sheet-cache.server.ts` so the policy can be tested directly —
 * that module reads through Vite's resolver and cannot be loaded by a bare Node
 * script, and a cache policy that is only exercised by hand is how "serve stale
 * forever" ships unnoticed.
 */

export interface SnapshotFreshness {
  /** Is a usable snapshot held at all? */
  hasCache: boolean;
  /** How long since the last load *attempt* for that snapshot. */
  cacheAgeMs: number;
  /** Is a rebuild already running? */
  refreshRunning: boolean;
  /** How long that rebuild has been running. Ignored when none is. */
  refreshAgeMs: number;
  /** The Refresh button: the caller asked for new numbers and will wait. */
  force: boolean;
}

export interface SnapshotLimits {
  /** Below this the snapshot is simply current. */
  ttlMs: number;
  /**
   * Above this the wait is taken rather than the number. Serving a stale
   * snapshot is the right trade for a few minutes; quietly reporting
   * half-hour-old collections on an accounting dashboard is not.
   */
  maxStaleMs: number;
  /**
   * Above this a running rebuild is presumed stuck and may be replaced.
   *
   * Nothing in the read path has a timeout. Without this rule one hung
   * PostgreSQL query freezes the data permanently: the in-flight handle never
   * clears, no later request can start another load, and every page goes on
   * serving the same snapshot with nothing on screen to say so.
   */
  stuckRefreshMs: number;
}

export type SnapshotAction =
  /** Hand back what is in memory. Nothing to do. */
  | "serve-cached"
  /** Hand back what is in memory, and start a rebuild behind the request. */
  | "serve-cached-refresh-behind"
  /** Wait on the rebuild already running. */
  | "join-refresh"
  /** Start a rebuild and wait for it. */
  | "refresh-and-wait";

export function decideSnapshotRead(
  state: SnapshotFreshness,
  limits: SnapshotLimits,
): SnapshotAction {
  // Forced reloads never read the cache and never join a rebuild already in
  // flight: that one was requested before the button was pressed, so returning
  // it hands back exactly the stale data the user was trying to escape.
  if (state.force) return "refresh-and-wait";

  if (state.hasCache) {
    if (state.cacheAgeMs < limits.ttlMs) return "serve-cached";
    if (state.cacheAgeMs < limits.maxStaleMs) {
      const stuck = state.refreshRunning && state.refreshAgeMs > limits.stuckRefreshMs;
      // A healthy rebuild is already on its way; starting a second one would
      // read the same tens of megabytes twice for no fresher answer.
      if (state.refreshRunning && !stuck) return "serve-cached";
      return "serve-cached-refresh-behind";
    }
    // Past the ceiling the cache is no longer an acceptable answer, so this
    // request waits — but it still joins a rebuild in flight rather than
    // starting a competing one.
  }

  return state.refreshRunning ? "join-refresh" : "refresh-and-wait";
}
