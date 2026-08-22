import type { DataHealth } from "./types";

/**
 * Archived Lost remains reportable when the direct Odoo read is temporarily
 * unavailable but PostgreSQL still holds the last successful Odoo snapshot.
 * Only `unavailable` means the dashboard has no safe Lost population.
 */
export function hasReportableLost(authority: DataHealth["lostAuthority"]): boolean {
  return authority !== "unavailable";
}

export function usesStoredLost(authority: DataHealth["lostAuthority"]): boolean {
  return authority === "postgres-last-good";
}
