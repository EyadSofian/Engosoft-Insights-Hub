export interface DemandMetric {
  orders: number;
  units: number;
}

/** Odoo names occasionally differ only by repeated/trailing spaces. */
export const normalizeDemandKey = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

/** Most requested first, then seats, with a stable human-readable tie-break. */
export function compareDemand(
  a: { demand?: DemandMetric; name: string },
  b: { demand?: DemandMetric; name: string },
): number {
  return (
    (b.demand?.orders ?? 0) - (a.demand?.orders ?? 0) ||
    (b.demand?.units ?? 0) - (a.demand?.units ?? 0) ||
    a.name.localeCompare(b.name)
  );
}
