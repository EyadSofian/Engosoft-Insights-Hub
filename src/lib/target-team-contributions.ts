import { normalizePersonName } from "./person-name.ts";
import type { TargetSource } from "./sales-targets.ts";

/** A contribution is an org assignment, not a new individual sales quota. */
export interface TeamPersonalSalesContribution {
  month: string;
  teamLeader: string;
  supervisor: string;
  paidRevenue: number;
  orderRevenue: number;
  invoices: number;
  orders: number;
}

export interface TeamContributionAmount {
  salesperson: string;
  date: string;
  amount: number;
  reference: string;
}

// Approved by management on 2026-11-08 after reconciling S21695/6/7.
// Employee 418 is the verified HR identity of Odoo user 114, Nader Aziz.
// Apply only to the approved month: an All-time view must not reassign old sales.
const ASSIGNMENTS = [
  { month: "2026-11", employeeId: "418", teamLeader: "Nader Aziz", supervisor: "Asmaa Fathy" },
] as const;

export function buildTeamPersonalSalesContributions(
  source: TargetSource,
  paidRows: readonly TeamContributionAmount[],
  orderRows: readonly TeamContributionAmount[],
  window: { from?: string; to?: string },
): Map<string, TeamPersonalSalesContribution> {
  const result = new Map<string, TeamPersonalSalesContribution>();
  for (const assignment of ASSIGNMENTS) {
    if (window.from && assignment.month < window.from.slice(0, 7)) continue;
    if (window.to && assignment.month > window.to.slice(0, 7)) continue;
    const person = source[assignment.month]?.find((p) => p.employeeId === assignment.employeeId);
    if (!person) continue;
    const names = new Set([person.name, ...person.aliases].map(normalizePersonName));
    const inScope = (row: TeamContributionAmount) =>
      row.date.slice(0, 7) === assignment.month &&
      (!window.from || row.date >= window.from) &&
      (!window.to || row.date <= window.to) &&
      names.has(normalizePersonName(row.salesperson));
    const paid = paidRows.filter(inScope);
    const orders = orderRows.filter(inScope);
    result.set(assignment.employeeId, {
      month: assignment.month,
      teamLeader: assignment.teamLeader,
      supervisor: assignment.supervisor,
      paidRevenue: paid.reduce((sum, row) => sum + row.amount, 0),
      orderRevenue: orders.reduce((sum, row) => sum + row.amount, 0),
      invoices: new Set(paid.map((row) => row.reference).filter(Boolean)).size,
      orders: new Set(orders.map((row) => row.reference).filter(Boolean)).size,
    });
  }
  return result;
}
