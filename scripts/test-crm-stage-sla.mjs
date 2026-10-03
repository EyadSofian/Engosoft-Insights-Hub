import assert from "node:assert/strict";
import { slaStage, stageSlaStatus, summarizeStageSla } from "../src/lib/crm-stage-sla.ts";

const row = (id, stageKey, stage, lastStageUpdateUtc, salesperson = "Sara") => ({
  id: String(id),
  stageKey,
  stage,
  lastStageUpdateUtc,
  salesperson,
  active: true,
  businessStatus: "open",
  contact: `Lead ${id}`,
});

assert.equal(slaStage(row(1, "other", "Long Follow Up", "")), "long_follow_up");
assert.equal(slaStage(row(1, "other", "Another Stage", "")), null);
assert.equal(slaStage({ ...row(1, "open", "Open", ""), businessStatus: "won" }), null);
assert.equal(slaStage({ ...row(1, "open", "Open", ""), active: false }), null);

const entered = "2026-10-03 08:00:00";
assert.equal(stageSlaStatus("new", entered, new Date("2026-10-03T15:59:00Z")).overdue, false);
assert.equal(stageSlaStatus("new", entered, new Date("2026-10-03T16:01:00Z")).overdue, true);
assert.equal(
  stageSlaStatus("new", entered, new Date("2026-10-03T16:01:00Z")).dueAt,
  "2026-10-03 19:00:00 Cairo",
);
assert.equal(stageSlaStatus("open", entered, new Date("2026-11-02T07:59:00Z")).overdue, false);
assert.equal(stageSlaStatus("open", entered, new Date("2026-11-02T08:01:00Z")).overdue, true);
assert.equal(
  stageSlaStatus("long_follow_up", entered, new Date("2026-12-02T08:01:00Z")).overdue,
  true,
);
assert.equal(stageSlaStatus("quotation", "", new Date()).overdue, null);

const summary = summarizeStageSla(
  [
    row(1, "new", "New", entered),
    row(2, "other", "Long Follow Up", "2026-08-01 08:00:00"),
    row(3, "quotation", "Quotation Sent", ""),
    row(4, "open", "Open", "2026-10-03 08:00:00", ""),
    { ...row(5, "won", "Won", entered), businessStatus: "won" },
  ],
  "https://engosoft.com",
  new Date("2026-10-03T16:01:00Z"),
);
assert.equal(summary.total, 4);
assert.equal(summary.overdue, 2);
assert.equal(summary.unknown, 1);
assert.equal(summary.unassigned, 1);
assert.equal(
  summary.employees.find((item) => item.name === "Sara")?.stages.long_follow_up.overdue,
  1,
);
assert.equal(
  summary.records.rows.find((item) => item.id === "2")?.odooUrl.includes("model=crm.lead"),
  true,
);
console.log("CRM stage SLA tests passed");
