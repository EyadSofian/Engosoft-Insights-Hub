import { matrixSource } from "./lead-source-matrix";

export interface SourceDistributionRecord {
  id: string;
  source: string;
  status: "lead" | "open" | "won" | "lost";
  createdAt: string;
  contact: string;
  stage: string;
  odooUrl: string;
}

export interface SourceDistributionRow {
  source: string;
  total: number;
  active: number;
  won: number;
  lost: number;
  share: number;
  wonRate: number;
  lostRate: number;
  /** An explicitly labelled newest sample, never presented as the full source population. */
  latestRecords: SourceDistributionRecord[];
}

/** One current Odoo record contributes to one source and exactly one outcome. */
export function crmSourceDistribution(records: readonly SourceDistributionRecord[]): SourceDistributionRow[] {
  const groups = new Map<string, SourceDistributionRow>();
  for (const record of records) {
    const source = matrixSource(record.source);
    const row = groups.get(source) ?? {
      source, total: 0, active: 0, won: 0, lost: 0,
      share: 0, wonRate: 0, lostRate: 0, latestRecords: [],
    };
    row.total++;
    if (record.status === "won") row.won++;
    else if (record.status === "lost") row.lost++;
    else row.active++;
    row.latestRecords.push({
      id: record.id,
      source: record.source,
      status: record.status,
      createdAt: record.createdAt,
      contact: record.contact,
      stage: record.stage,
      odooUrl: record.odooUrl,
    });
    groups.set(source, row);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      share: records.length ? row.total / records.length * 100 : 0,
      wonRate: row.total ? row.won / row.total * 100 : 0,
      lostRate: row.total ? row.lost / row.total * 100 : 0,
      latestRecords: row.latestRecords
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, 12),
    }))
    .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
}
