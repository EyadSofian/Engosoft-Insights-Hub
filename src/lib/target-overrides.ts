// The pure half of the editable target layer: what an override is, and how it
// merges onto the published seed. Kept free of any runtime import so the merge
// rules — which decide whether a save can wipe a quota — are directly testable.
import type { SalesTarget, TargetSource } from "./sales-targets.ts";

export interface TargetOverride {
  month: string;
  employeeId: string;
  /** `null` means "published no quota", which is not the same as zero. */
  target: number | null;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

const str = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

/** `""` is a published-nothing marker, not a zero. */
function parseTarget(raw: unknown): number | null {
  const value = str(raw);
  if (value === "" || value.toLowerCase() === "null") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function overrideKey(month: string, employeeId: string): string {
  return `target|${month}|${employeeId}`;
}

export function toOverride(row: Record<string, string>): TargetOverride | null {
  const month = str(row.month);
  const employeeId = str(row.employeeId);
  if (!/^\d{4}-\d{2}$/.test(month) || !employeeId) return null;
  return {
    month,
    employeeId,
    target: parseTarget(row.target),
    note: str(row.note),
    updatedAt: str(row.updatedAt),
    updatedBy: str(row.updatedBy),
  };
}

/**
 * Apply overrides to the seed. An override for someone not in the seed is added
 * as a new entry, so a new hire can be given a quota from the screen without a
 * deploy; the workbook spelling is then the only name it can match, which the
 * unmatched report will surface if Odoo spells them differently.
 */
export function applyOverrides(seed: TargetSource, overrides: TargetOverride[]): TargetSource {
  if (!overrides.length) return seed;
  const merged: TargetSource = {};
  for (const [month, entries] of Object.entries(seed))
    merged[month] = entries.map((e) => ({ ...e }));

  for (const override of overrides) {
    const entries = (merged[override.month] ??= []);
    const existing = entries.find((entry) => entry.employeeId === override.employeeId);
    if (existing) {
      existing.target = override.target;
      if (override.note) existing.note = override.note;
      continue;
    }
    const template = Object.values(seed)
      .flat()
      .find((entry) => entry.employeeId === override.employeeId);
    entries.push({
      employeeId: override.employeeId,
      name: template?.name || override.employeeId,
      aliases: template ? [...template.aliases] : [],
      teamLeader: template?.teamLeader ?? "",
      supervisor: template?.supervisor ?? "",
      branch: template?.branch ?? "",
      target: override.target,
      note: override.note || template?.note || "",
    } satisfies SalesTarget);
  }
  return merged;
}
