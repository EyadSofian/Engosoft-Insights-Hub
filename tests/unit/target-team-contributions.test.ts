import { describe, expect, it } from "vitest";
import { SALES_TARGETS } from "@/lib/sales-targets";
import {
  buildTeamPersonalSalesContributions,
  type TeamContributionAmount,
} from "@/lib/target-team-contributions";
import { buildTargetUnitRollup, type TargetUnitMemberInput } from "@/lib/target-units";

const paid: TeamContributionAmount[] = [
  {
    salesperson: "Nader Aziz",
    date: "2026-11-03",
    reference: "INVNT/2026/003127",
    amount: 400.5099724988653,
  },
  {
    salesperson: "Nader Aziz",
    date: "2026-11-03",
    reference: "INVNT/2026/003128",
    amount: 400.5099724988653,
  },
  {
    salesperson: "Nader Aziz",
    date: "2026-11-03",
    reference: "INVNT/2026/003129",
    amount: 400.5099724988653,
  },
];
const orders = paid.map((row, index) => ({
  ...row,
  reference: `S${21695 + index}`,
  amount: 400.50801,
}));
const window = { from: "2026-11-01", to: "2026-11-08" };
const historicalBefore = JSON.stringify(SALES_TARGETS["2026-10"]);
const resolve = (p = paid, o = orders, w = window) =>
  buildTeamPersonalSalesContributions(SALES_TARGETS, p, o, w);
const roster: TargetUnitMemberInput[] = SALES_TARGETS["2026-11"]
  .filter((row) => row.target !== null)
  .map((row) => ({ ...row, key: row.employeeId, paidRevenue: 0, orderRevenue: 0 }));

describe("approved team leader personal sales", () => {
  it("reconciles the three orders and paid invoices without making a personal quota", () => {
    const c = resolve().get("418")!;
    expect(c).toMatchObject({
      month: "2026-11",
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      invoices: 3,
      orders: 3,
    });
    expect(c.paidRevenue).toBeCloseTo(1201.5299174965958, 8);
    expect(c.orderRevenue).toBeCloseTo(1201.52403, 8);
    expect(SALES_TARGETS["2026-11"].find((p) => p.employeeId === "418")?.target).toBeNull();
  });
  it("counts invoice lines as one document while summing their actual amounts", () => {
    const lines = [
      { ...paid[0], amount: 100 },
      { ...paid[0], amount: 200 },
      { ...paid[0], amount: 50 },
    ];
    const c = resolve(lines).get("418")!;
    expect(c.invoices).toBe(1);
    expect(c.paidRevenue).toBe(350);
  });
  it("adds the contribution once to Nader's team and Asmaa's unit, never Resale", () => {
    const c = resolve().get("418")!;
    const leader: TargetUnitMemberInput = {
      key: "nader aziz",
      employeeId: "418",
      name: "Nader Refaat Aziz",
      target: null,
      paidRevenue: c.paidRevenue,
      orderRevenue: c.orderRevenue,
      teamLeader: c.teamLeader,
      supervisor: c.supervisor,
      leaderPersonalSales: true,
    };
    const r = buildTargetUnitRollup([...roster, leader, { ...leader, key: "duplicate-alias" }]);
    expect(r.target).toBe(139500);
    expect(r.paidRevenue).toBeCloseTo(c.paidRevenue, 8);
    expect(r.unassigned).toHaveLength(0);
    const unit = r.units.find((u) => u.key === "asmaa")!;
    expect(unit.target).toBe(59000);
    expect(unit.paidRevenue).toBeCloseTo(c.paidRevenue, 8);
    const team = unit.leaders.find((t) => t.key === "nader-aziz")!;
    expect(team.target).toBe(45000);
    expect(team.achievement).toBeCloseTo((c.paidRevenue / 45000) * 100, 8);
    expect(team.remaining).toBeCloseTo(45000 - c.paidRevenue, 8);
    expect(team.members.find((m) => m.employeeId === "418")).toMatchObject({
      target: null,
      achievement: null,
      remaining: null,
    });
    expect(unit.leaders.find((t) => t.key === "nader-aziz-resale")?.paidRevenue).toBe(0);
    // Reading a team contribution does not mutate or add to the company ledger.
    expect(paid.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(c.paidRevenue, 8);
  });
  it("does not include unapproved untargeted sellers or infer identities by name similarity", () => {
    const c = resolve([
      ...paid,
      { ...paid[0], salesperson: "Nader Ahmed Aziz", amount: 99999 },
    ]).get("418")!;
    expect(c.paidRevenue).toBeCloseTo(1201.5299174965958, 8);
    const r = buildTargetUnitRollup([
      ...roster,
      { ...roster[0], key: "unapproved", employeeId: "new", target: null, paidRevenue: 99999 },
    ]);
    expect(r.paidRevenue).toBe(0);
  });
  it("does not backdate the assignment or reclassify older collections in mixed periods", () => {
    const mixed = [
      ...paid,
      { ...paid[0], date: "2026-10-03", amount: 90000 },
      { ...paid[0], date: "2026-12-03", amount: 70000 },
    ];
    const c = resolve(mixed, orders, { from: "2026-01-01", to: "2026-12-31" }).get("418")!;
    expect(c.paidRevenue).toBeCloseTo(1201.5299174965958, 8);
    expect(resolve(mixed, orders, { from: "2026-10-01", to: "2026-10-31" }).size).toBe(0);
    expect(resolve(mixed, orders, { from: "2026-12-01", to: "2026-12-31" }).size).toBe(0);
    expect(
      resolve(paid, orders, { from: "2026-11-04", to: "2026-11-08" }).get("418")?.paidRevenue,
    ).toBe(0);
    expect(JSON.stringify(SALES_TARGETS["2026-10"])).toBe(historicalBefore);
  });
});
