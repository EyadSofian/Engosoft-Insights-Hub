import assert from "node:assert/strict";
import { buildTargetUnitRollup } from "../src/lib/target-units.ts";

const targets = [
  ["238", 9000],
  ["338", 9000],
  ["482", 9000],
  ["503", 9000],
  ["606", 9000],
  ["346", 9000],
  ["630", 9000],
  ["602", 9000],
  ["635", 3000],
  ["632", 12000],
  ["558", 9000],
  ["631", 9000],
  ["457", 9000],
  ["619", 9000],
  ["378", 6000],
  ["292", 6000],
  ["235", 3000],
  ["597", 3000],
  ["335", 12000],
  ["319", 9000],
].map(([employeeId, target], index) => ({
  key: `employee-${employeeId}`,
  employeeId,
  name: `Employee ${employeeId}`,
  target,
  paidRevenue: index === 0 ? 9000 : 0,
  orderRevenue: 0,
}));

const result = buildTargetUnitRollup(targets);

assert.equal(result.target, 162000, "grand target must match the approved September target");
assert.equal(result.units[0].target, 75000, "Bahaa unit target");
assert.equal(result.units[0].leaders[0].target, 54000, "Bahaa Ramadan team target");
assert.equal(result.units[0].leaders[1].target, 21000, "Ahmed Saeed team target");
assert.equal(result.units[1].target, 66000, "Asmaa unit target");
assert.equal(result.units[1].leaders[0].target, 60000, "Nader Aziz team target");
assert.equal(result.units[1].leaders[1].target, 6000, "Asmaa Fathy team target");
assert.deepEqual(
  result.standalone.map((member) => member.target),
  [12000, 9000],
);
assert.equal(result.unassigned.length, 0);
assert.equal(result.paidRevenue, 9000);
assert.equal(result.achievement, (9000 / 162000) * 100);

const withNewEmployee = buildTargetUnitRollup([
  ...targets,
  {
    key: "new",
    employeeId: "999",
    name: "New employee",
    target: 1000,
    paidRevenue: 0,
    orderRevenue: 0,
  },
]);
assert.equal(withNewEmployee.unassigned.length, 1, "new published targets must not disappear");
assert.equal(withNewEmployee.target, 163000, "unassigned targets remain in the grand total");

console.log("target unit rollup tests passed");
