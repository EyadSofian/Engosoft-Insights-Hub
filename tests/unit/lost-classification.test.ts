import { describe, expect, it } from "vitest";
import {
  classifyLostRow,
  lostPopulationCounts,
  lostPopulations,
  rankHighestClosedLost,
} from "@/lib/lost-classification";

const window = { from: "2026-09-01", to: "2026-09-15" };
const row = (id: string, createdAt: string, closeDate: string) => ({ id, createdAt, closeDate });

// Synthetic Lost records covering every combination of the two dates.
const rows = [
  row("created-and-closed", "2026-09-03", "2026-09-10"),
  row("created-closed-later", "2026-09-05", "2026-09-20"),
  row("created-not-closed", "2026-09-06", ""),
  row("older-closed-in", "2026-07-11", "2026-09-02"),
  row("older-closed-before", "2026-06-01", "2026-08-30"),
  row("undated-closed-in", "", "2026-09-12"),
  row("after-window", "2026-09-20", "2026-09-21"),
];

describe("lost cohort vs closed-lost movement", () => {
  const populations = lostPopulations({ cohortRows: rows, closedRows: rows, window });
  const counts = lostPopulationCounts(populations);

  it("counts the cohort by creation date only", () => {
    expect(populations.cohortLost.map((r) => r.id)).toEqual([
      "created-and-closed",
      "created-closed-later",
      "created-not-closed",
    ]);
  });

  it("counts closures by Lost/Close Date only", () => {
    expect(populations.closedLostInPeriod.map((r) => r.id)).toEqual([
      "created-and-closed",
      "older-closed-in",
      "undated-closed-in",
    ]);
  });

  it("never mixes the populations: a lead can be cohort Lost without closing in the window and vice versa", () => {
    const cohort = new Set(populations.cohortLost.map((r) => r.id));
    const closed = new Set(populations.closedLostInPeriod.map((r) => r.id));
    expect(cohort.has("created-closed-later") && !closed.has("created-closed-later")).toBe(true);
    expect(!cohort.has("older-closed-in") && closed.has("older-closed-in")).toBe(true);
  });

  it("deduplicates by Odoo id", () => {
    const duplicated = lostPopulations({
      cohortRows: [...rows, rows[0]!],
      closedRows: [...rows, rows[0]!],
      window,
    });
    expect(lostPopulationCounts(duplicated)).toEqual(counts);
  });
});

describe("older-cohort closed-lost split", () => {
  const counts = lostPopulationCounts(
    lostPopulations({ cohortRows: rows, closedRows: rows, window }),
  );

  it("splits closures into created-in-period, older-cohort and undated-cohort", () => {
    expect(counts.createdAndLostInPeriod).toBe(1);
    expect(counts.olderCohortClosedLostInPeriod).toBe(1);
    expect(counts.undatedCohortClosedLostInPeriod).toBe(1);
  });

  it("always adds the split back to closedLostInPeriod", () => {
    expect(
      counts.createdAndLostInPeriod +
        counts.olderCohortClosedLostInPeriod +
        counts.undatedCohortClosedLostInPeriod,
    ).toBe(counts.closedLostInPeriod);
  });

  it("classifies one row the same way the population split does", () => {
    expect(classifyLostRow(row("x", "2026-08-31", "2026-09-01"), window).closedSplit).toBe(
      "older_cohort",
    );
    expect(classifyLostRow(row("x", "2026-09-01", "2026-09-01"), window).closedSplit).toBe(
      "created_in_period",
    );
    expect(classifyLostRow(row("x", "2026-09-01", "2026-09-16"), window).closedSplit).toBeNull();
  });
});

describe("employee Closed Lost ranking", () => {
  const employees = [
    { name: "A", lost: 90, closedLostInPeriod: 3, olderCohortClosedLostInPeriod: 1 },
    { name: "B", lost: 5, closedLostInPeriod: 40, olderCohortClosedLostInPeriod: 30 },
    { name: "C", lost: 20, closedLostInPeriod: 40, olderCohortClosedLostInPeriod: 10 },
    { name: "D", lost: 60, closedLostInPeriod: 0, olderCohortClosedLostInPeriod: 0 },
  ];

  it("ranks by closedLostInPeriod, not by the cohort lost field", () => {
    expect(rankHighestClosedLost(employees).map((row) => row.name)).toEqual(["B", "C", "A"]);
  });

  it("does not list employees with no closures in the period", () => {
    expect(rankHighestClosedLost(employees).some((row) => row.name === "D")).toBe(false);
  });
});
