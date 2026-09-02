export interface DemandMetric {
  orders: number;
  units: number;
}

/** Odoo names occasionally differ only by repeated/trailing spaces. */
export const normalizeDemandKey = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

/**
 * The commercial order management wants to see before demand decides the rest.
 * Matching uses both the course name and its subcategory because some workbook
 * rows carry the family only in one of those fields.
 */
const COURSE_DISPLAY_PRIORITY = [
  /\bcfm\b/i,
  /\bpmp\b/i,
  /\bautomotive\b/i,
  /\belectrical\b/i,
  /\bcmrp\b/i,
];

export function courseDisplayPriority(name: string, subcategory = ""): number {
  const value = `${name} ${subcategory}`;
  const rank = COURSE_DISPLAY_PRIORITY.findIndex((pattern) => pattern.test(value));
  return rank === -1 ? COURSE_DISPLAY_PRIORITY.length : rank;
}

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
