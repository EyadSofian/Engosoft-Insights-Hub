/**
 * Pure planning rules for the Meta catalog reconciliation. Kept free of I/O so
 * the "what gets read, what is skipped, when to stop" decisions are tested.
 */

export interface ReconcileCandidate {
  adId: string;
  accountId: string;
  campaignId: string;
  adsetId: string;
  hasCreativeRow: boolean;
  /** The stored creative row already carries the lead-form and asset columns. */
  currentSchema: boolean;
  syncedAt: string;
  lastFailure: string;
}

/** Re-read a current row after this long, so edited creatives are picked up. */
export const RECONCILE_STALE_DAYS = 7;

export function reconcileTargets(
  candidates: readonly ReconcileCandidate[],
  options: { maxAds: number; force: boolean; now?: number },
): { targets: ReconcileCandidate[]; skipped: number } {
  const now = options.now ?? Date.now();
  const stale = (iso: string, days: number) => {
    const at = Date.parse(iso);
    return !Number.isFinite(at) || now - at > days * 86_400_000;
  };
  const due = candidates.filter((candidate) => {
    if (!/^\d{6,}$/.test(candidate.adId)) return false;
    if (options.force) return true;
    if (!candidate.hasCreativeRow || !candidate.currentSchema) return true;
    return stale(candidate.syncedAt, RECONCILE_STALE_DAYS);
  });
  // Missing creatives first, then old-schema rows, then merely stale rows.
  const rank = (candidate: ReconcileCandidate) =>
    !candidate.hasCreativeRow ? 0 : !candidate.currentSchema ? 1 : 2;
  const ordered = due
    // An ad Meta refused stays recorded with its reason; only `force` asks again.
    .filter((candidate) => options.force || !candidate.lastFailure)
    .sort((a, b) => rank(a) - rank(b) || a.adId.localeCompare(b.adId));
  const targets = ordered.slice(0, Math.max(0, options.maxAds));
  return { targets, skipped: candidates.length - targets.length };
}

/** Meta rate-limit and throttling error codes: stop and resume later. */
const THROTTLE_CODES = new Set(["4", "17", "32", "613", "80000", "80003", "80004", "80014"]);

export function isThrottleError(error: { code?: unknown }): boolean {
  return THROTTLE_CODES.has(String(error.code ?? ""));
}

/**
 * Highest usage percentage Meta reports in its rate-limit headers. Each header
 * is JSON; business-use-case usage is keyed by object ID with a list of limits.
 */
export function graphUsagePercent(headers: {
  app?: string | null;
  business?: string | null;
  account?: string | null;
}): number {
  const values: number[] = [];
  const collect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof entry === "number" &&
        /call_count|total_cputime|total_time|acc_id_util_pct/.test(key)
      ) {
        values.push(entry);
      } else if (Array.isArray(entry)) {
        entry.forEach(collect);
      } else if (entry && typeof entry === "object") {
        collect(entry);
      }
    }
  };
  for (const raw of [headers.app, headers.business, headers.account]) {
    if (!raw) continue;
    try {
      collect(JSON.parse(raw));
    } catch {
      // A malformed header is not a reason to stop reading.
    }
  }
  return values.length ? Math.max(...values) : 0;
}

/** Strips a token (and any access_token query value) out of text before it is stored or logged. */
export function redactMetaSecrets(message: string, token: string): string {
  const withoutToken = token ? message.split(token).join("<redacted>") : message;
  return withoutToken
    .replace(/access_token=[^&\s"]+/gi, "access_token=<redacted>")
    .replace(/appsecret_proof=[^&\s"]+/gi, "appsecret_proof=<redacted>")
    .slice(0, 240);
}
