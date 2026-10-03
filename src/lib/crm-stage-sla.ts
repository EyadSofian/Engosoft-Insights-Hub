import type { CrmLeadRow } from "./types.ts";

export type SlaStage = "new" | "open" | "long_follow_up" | "quotation";
export const SLA_STAGES: readonly SlaStage[] = ["new", "open", "long_follow_up", "quotation"];
export const SLA_POLICY: Record<SlaStage, { label: string; days: number | null }> = {
  new: { label: "New", days: null },
  open: { label: "Open", days: 30 },
  long_follow_up: { label: "Long Follow Up", days: 60 },
  quotation: { label: "Quotation Sent", days: 30 },
};

export interface SlaLead {
  id: string;
  salesperson: string;
  contact: string;
  stage: SlaStage;
  stageName: string;
  stageEnteredUtc: string;
  dueAt: string;
  overdue: boolean | null;
  odooUrl: string;
}

export interface SlaCell {
  count: number;
  overdue: number;
  unknown: number;
}
export interface SlaEmployee {
  name: string;
  total: number;
  overdue: number;
  unknown: number;
  stages: Record<SlaStage, SlaCell>;
}
export interface SlaSummary {
  asOf: string;
  timezone: "Africa/Cairo";
  cohort: "lead_creation_date";
  basis: "current_stage_since_last_stage_update";
  total: number;
  overdue: number;
  unknown: number;
  unassigned: number;
  employees: SlaEmployee[];
  records: { rows: SlaLead[]; total: number; truncated: boolean };
}

const emptyCell = (): SlaCell => ({ count: 0, overdue: 0, unknown: 0 });
const stageCells = (): Record<SlaStage, SlaCell> => ({
  new: emptyCell(),
  open: emptyCell(),
  long_follow_up: emptyCell(),
  quotation: emptyCell(),
});

/** Long Follow Up is an Odoo stage absent from the older canonical XMLID map.
 * Match its exact current Odoo label only for this SLA report, not for the
 * global lifecycle counts or Won/Lost classification. */
export function slaStage(
  row: Pick<CrmLeadRow, "stageKey" | "stage" | "active" | "businessStatus">,
): SlaStage | null {
  if (!row.active || (row.businessStatus !== "lead" && row.businessStatus !== "open")) return null;
  if (row.stageKey === "new" || row.stageKey === "open" || row.stageKey === "quotation")
    return row.stageKey;
  if (row.stageKey === "other" && row.stage.trim().toLowerCase() === "long follow up")
    return "long_follow_up";
  return null;
}

function utcDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)) return null;
  const d = new Date(
    /[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw.replace(" ", "T") : `${raw.replace(" ", "T")}Z`,
  );
  return Number.isFinite(d.getTime()) ? d : null;
}

function cairoClock(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function stageSlaStatus(
  stage: SlaStage,
  enteredUtc: string,
  now = new Date(),
): { overdue: boolean | null; dueAt: string } {
  const entered = utcDate(enteredUtc);
  if (!entered) return { overdue: null, dueAt: "" };
  if (stage === "new") {
    const dueAt = `${cairoClock(entered).slice(0, 10)} 19:00:00`;
    return { overdue: cairoClock(now) > dueAt, dueAt: `${dueAt} Cairo` };
  }
  const due = new Date(entered.getTime() + (SLA_POLICY[stage].days ?? 0) * 86_400_000);
  return { overdue: now.getTime() > due.getTime(), dueAt: due.toISOString() };
}

export function summarizeStageSla(
  rows: CrmLeadRow[],
  odooBaseUrl: string,
  now = new Date(),
  cap = 5000,
): SlaSummary {
  const employees = new Map<string, SlaEmployee>();
  const records: SlaLead[] = [];
  let total = 0;
  let overdue = 0;
  let unknown = 0;
  let unassigned = 0;
  for (const row of rows) {
    const stage = slaStage(row);
    if (!stage) continue;
    const name = row.salesperson.trim() || "—";
    if (name === "—") unassigned++;
    let employee = employees.get(name);
    if (!employee) {
      employee = { name, total: 0, overdue: 0, unknown: 0, stages: stageCells() };
      employees.set(name, employee);
    }
    const status = stageSlaStatus(stage, row.lastStageUpdateUtc, now);
    total++;
    employee.total++;
    employee.stages[stage].count++;
    if (status.overdue === true) {
      overdue++;
      employee.overdue++;
      employee.stages[stage].overdue++;
    } else if (status.overdue === null) {
      unknown++;
      employee.unknown++;
      employee.stages[stage].unknown++;
    }
    records.push({
      id: row.id,
      salesperson: name,
      contact: row.contact,
      stage,
      stageName: row.stage,
      stageEnteredUtc: row.lastStageUpdateUtc,
      dueAt: status.dueAt,
      overdue: status.overdue,
      odooUrl: row.id
        ? `${odooBaseUrl}/web#id=${encodeURIComponent(row.id)}&model=crm.lead&view_type=form`
        : "",
    });
  }
  records.sort(
    (a, b) =>
      Number(b.overdue === true) - Number(a.overdue === true) || a.dueAt.localeCompare(b.dueAt),
  );
  return {
    asOf: now.toISOString(),
    timezone: "Africa/Cairo",
    cohort: "lead_creation_date",
    basis: "current_stage_since_last_stage_update",
    total,
    overdue,
    unknown,
    unassigned,
    employees: [...employees.values()].sort(
      (a, b) => b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name),
    ),
    records: {
      rows: records.slice(0, cap),
      total: records.length,
      truncated: records.length > cap,
    },
  };
}
