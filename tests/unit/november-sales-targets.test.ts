import { describe, expect, it } from "vitest";
import { SALES_TARGETS, targetIndexForMonth } from "@/lib/sales-targets";
import {
  buildTargetUnitRollup,
  includeTargetRoster,
  type TargetUnitMemberInput,
} from "@/lib/target-units";
import {
  applyOverrides,
  isCurrentTargetOverride,
  NOVEMBER_WORKBOOK_PUBLISHED_AT,
} from "@/lib/target-overrides";

const source = SALES_TARGETS["2026-11"];
const published = source.filter((row) => row.target !== null);
const members = (month: string): TargetUnitMemberInput[] =>
  SALES_TARGETS[month]
    .filter((row) => row.target !== null)
    .map((row) => ({ ...row, key: row.employeeId, paidRevenue: 0, orderRevenue: null }));
const sum = (month: string) =>
  SALES_TARGETS[month].reduce((sum, row) => sum + (row.target ?? 0), 0);

describe("AAA.xlsx November publication", () => {
  it("reconciles 23 people and the five teams to both source unit totals", () => {
    expect(published).toHaveLength(23);
    expect(sum("2026-11")).toBe(139500);
    expect(targetIndexForMonth("2026-11").duplicates).toEqual([]);
    const result = buildTargetUnitRollup(members("2026-11"));
    expect(result.units.map((unit) => [unit.key, unit.target])).toEqual([
      ["bahaa", 80500],
      ["asmaa", 59000],
    ]);
    expect(
      result.units.flatMap((unit) =>
        unit.leaders.map((team) => [team.key, team.target, team.members.length]),
      ),
    ).toEqual([
      ["bahaa-ramadan", 54000, 6],
      ["ahmed-saeed", 26500, 5],
      ["nader-aziz", 45000, 6],
      ["nader-aziz-resale", 8000, 2],
      ["asmaa-fathy", 6000, 4],
    ]);
    expect(result.unassigned).toEqual([]);
    expect(result.target).toBe(139500);
  });
  it("applies only November moves and keeps historic quotas and hierarchy", () => {
    const result = buildTargetUnitRollup(members("2026-10"));
    expect(result.units.map((u) => u.target)).toEqual([82500, 75000]);
    const octoberNader = result.units[1].leaders.find((l) => l.key === "nader-aziz")!;
    expect(octoberNader.target).toBe(51000);
    expect(octoberNader.members.some((m) => m.employeeId === "292")).toBe(true);
    expect(result.units[1].leaders.some((l) => l.key === "nader-aziz-resale")).toBe(false);
    expect(sum("2026-08")).toBe(135276);
    expect(sum("2026-10")).toBe(157500);
    expect(
      SALES_TARGETS["2026-10"].find((r) => r.employeeId === "workbook:radwa-samah")?.teamLeader,
    ).toBe("Asmaa Fathy");
    expect(source.find((r) => r.employeeId === "workbook:radwa-samah")?.teamLeader).toBe(
      "Ahmed Saeed",
    );
  });
  it("does not give absent people an old quota and preserves the published zero", () => {
    expect(source.find((r) => r.employeeId === "319")).toMatchObject({
      target: null,
      teamLeader: "",
      supervisor: "",
    });
    expect(source.find((r) => r.employeeId === "457")?.target).toBeNull();
    expect(source.find((r) => r.employeeId === "335")?.target).toBe(0);
  });
  it("retains quotas for people with no activity without doubling known employees", () => {
    const roster = published.map((r) => ({ ...r, target: r.target! }));
    const activity = members("2026-11").slice(0, 1);
    activity[0].paidRevenue = 1000;
    const merged = includeTargetRoster(activity, roster);
    expect(merged).toHaveLength(23);
    expect(merged.filter((r) => r.rosterOnly)).toHaveLength(22);
    const result = buildTargetUnitRollup(merged);
    expect(result.target).toBe(139500);
    expect(result.paidRevenue).toBe(1000);
  });
  it("supersedes only pre-publication November edits and accepts later changes", () => {
    const base = {
      month: "2026-11",
      employeeId: "335",
      target: 999,
      note: "",
      updatedAt: "2026-11-03T22:00:00Z",
      updatedBy: "test",
    };
    expect(isCurrentTargetOverride(base)).toBe(false);
    expect(isCurrentTargetOverride({ ...base, month: "2026-09" })).toBe(true);
    const newer = { ...base, updatedAt: NOVEMBER_WORKBOOK_PUBLISHED_AT };
    expect(isCurrentTargetOverride(newer)).toBe(true);
    const merged = applyOverrides(SALES_TARGETS, [newer]);
    expect(merged["2026-11"].find((r) => r.employeeId === "335")?.target).toBe(999);
    expect(merged["2026-11"].find((r) => r.employeeId === "335")?.teamLeader).toBe("Asmaa Fathy");
    expect(SALES_TARGETS["2026-11"].find((r) => r.employeeId === "335")?.target).toBe(0);
  });
});
