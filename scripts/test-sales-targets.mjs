import assert from "node:assert/strict";
import {
  SALES_TARGETS,
  daysInMonth,
  monthCoverage,
  monthsInWindow,
  targetIndexForMonth,
  targetsByPerson,
  windowTarget,
} from "../src/lib/sales-targets.ts";
import { normalizePersonName } from "../src/lib/person-name.ts";

const MONTH = "2026-08";
const august = SALES_TARGETS[MONTH];

/* --- the workbook's own totals must survive transcription ------------------ */

const sum = (rows) => rows.reduce((total, row) => total + (row.target ?? 0), 0);
const byLeader = (leader) => august.filter((row) => row.teamLeader === leader);

assert.equal(sum(august), 138_276, "Total Mahfouz Target");
assert.equal(sum(byLeader("Bahaa Ramdan")), 57_276, "Subtotal — Bahaa Ramdan");
assert.equal(sum(byLeader("Ahmed Saeed")), 10_000, "Subtotal - Ahmed saeed");
assert.equal(sum(byLeader("Hady Mahmoud Fahmy")), 15_000, "Subtotal — Hady mahmoud fahmy");
assert.equal(sum(byLeader("Nader Aziz")), 40_000, "Subtotal — Nader Aziz");
assert.equal(sum(byLeader("Asmaa Fathy")), 6_000, "Subtotal — Asmaa Fathy");
assert.equal(sum(byLeader("Mahfouz Afify")), 10_000, "Total Target Saudi Brunch");
assert.equal(sum(byLeader("Operation")), 0, "Operation carries no quota");

// The workbook's own supervisor rollups.
const bySupervisor = (name) => august.filter((row) => row.supervisor === name);
assert.equal(sum(bySupervisor("Bahaa Ramadan")), 82_276, "Total Target Bahaa");
assert.equal(sum(bySupervisor("Asmaa Fathy")), 46_000, "Total Target Asmaa");

/* --- a blank target is not a zero ------------------------------------------ */

const onLeave = august.find((row) => row.employeeId === "457");
assert.equal(onLeave.target, null, "maternity leave publishes no target");
assert.equal(onLeave.note, "أجازة وضع");

const teamLeader = august.find((row) => row.employeeId === "418");
assert.equal(teamLeader.target, 0, "a real zero must stay 0, not null");

assert.equal(
  august.filter((row) => row.target === null).length,
  8,
  "one maternity leave plus seven Operation staff",
);

/* --- the three names Odoo spells differently ------------------------------- */

const { byName, duplicates } = targetIndexForMonth(MONTH);
assert.deepEqual(duplicates, [], "no employee may be declared twice in a month");

const resolve = (dashboardName) => byName.get(normalizePersonName(dashboardName));

// These are the spellings a live /api/teams response actually returned on
// 2026-08-16. They are asserted, not assumed: every one of them differs from
// the workbook, and an unnoticed drift here silently drops a person's quota.
assert.equal(resolve("Abdullah Mohsen Abdelhamed Saeed Hassan eljamal")?.employeeId, "335");
assert.equal(resolve("AHMED FAROUK")?.employeeId, "378");
assert.equal(resolve("Hazem Talat")?.employeeId, "619");
assert.equal(resolve("Mahmoud Hassan Elsayed Amer")?.employeeId, "632");
// Operation staff resolve too, so they read as "untargeted", not "no target".
assert.equal(resolve("Ahmed Hesham")?.employeeId, "303");
assert.equal(resolve("Abdulrahman Adel")?.employeeId, "417");

assert.equal(resolve("Abdullah Mohsen Abdul Hamid")?.employeeId, "335");
assert.equal(resolve("Ahmed Farouk Mohamed Mohamed")?.employeeId, "378");
assert.equal(resolve("mahmoud hassan elsayed amer")?.employeeId, "632");
// The workbook spelling has to keep working too.
assert.equal(resolve("mahmoud hassan elsayed amer (website)")?.employeeId, "632");
assert.equal(resolve("Mr.Mohamad Abdullah Mohamad Mohsen")?.employeeId, "482");
assert.equal(resolve("MENNA TULLAH MUSTAFA ALI MUSTAFA")?.employeeId, "503");

// A shortened name only resolves when it is declared as an alias. "AHMED
// FAROUK" matches because Odoo genuinely uses it; an undeclared truncation must
// not, or the first Ahmed in the sheet inherits someone else's quota.
assert.equal(resolve("Ahmed Saeed"), undefined);
assert.equal(resolve("Abdullah Mohsen"), undefined);
assert.equal(resolve("Mahmoud Mohamed"), undefined);

/* --- the per-person view the dashboard actually reads ---------------------- */

const people = targetsByPerson();
assert.deepEqual(people.duplicates, [], "no name may resolve to two employees");
assert.equal(people.byName.size >= august.length, true);

const website = people.byName.get(normalizePersonName("mahmoud hassan elsayed amer"));
assert.equal(website.entry.employeeId, "632");
assert.deepEqual(website.monthly, [{ month: "2026-08", target: 12000 }]);
assert.equal(website.entry.teamLeader, "Nader Aziz");

const leaveMonthly = people.byName.get(
  normalizePersonName("Mennatallah walid Mohamed Fathy"),
).monthly;
assert.deepEqual(leaveMonthly, [{ month: "2026-08", target: null }]);

/* --- calendar ------------------------------------------------------------- */

assert.equal(daysInMonth("2026-08"), 31);
assert.equal(daysInMonth("2026-02"), 28);
assert.equal(daysInMonth("2024-02"), 29);

assert.equal(monthCoverage("2026-08", "2026-08-01", "2026-08-31"), 1);
assert.equal(monthCoverage("2026-08", "2026-08-01", "2026-08-12"), 12 / 31);
assert.equal(monthCoverage("2026-08", "2026-09-01", "2026-09-30"), 0);
// An open-ended side means the whole month on that side.
assert.equal(monthCoverage("2026-08", undefined, undefined), 1);

assert.deepEqual(monthsInWindow("2026-06-15", "2026-08-03", []), ["2026-06", "2026-07", "2026-08"]);
assert.deepEqual(monthsInWindow(undefined, undefined, ["2026-08"]), ["2026-08"]);

/* --- prorating a monthly quota onto a dashboard window --------------------- */

const monthly = [{ month: "2026-08", target: 9000 }];

const wholeMonth = windowTarget(monthly, "2026-08-01", "2026-08-31");
assert.equal(wholeMonth.target, 9000);
assert.equal(wholeMonth.complete, true);
assert.equal(wholeMonth.wholeMonths, true);

// "Rank till 12 Aug" is 12 of 31 days — comparing it to the full quota is the
// mistake this proration exists to prevent.
const partial = windowTarget(monthly, "2026-08-01", "2026-08-12");
assert.equal(Math.round(partial.target), Math.round((9000 * 12) / 31));
assert.equal(partial.wholeMonths, false);
assert.equal(partial.complete, true);

// Year to date: only August publishes a target, so the comparison covers part
// of the window and must say so.
const ytd = windowTarget(monthly, "2026-01-01", "2026-08-31");
assert.equal(ytd.target, 9000);
assert.equal(ytd.complete, false);
assert.equal(ytd.monthsMissing.length, 7);

// A window entirely outside the published months yields no target at all,
// rather than a zero that would read as "achieved nothing".
const outside = windowTarget(monthly, "2026-09-01", "2026-09-30");
assert.equal(outside.target, null);
assert.equal(outside.monthsCovered.length, 0);

// An untargeted employee stays untargeted whatever the window.
assert.equal(
  windowTarget([{ month: "2026-08", target: null }], "2026-08-01", "2026-08-31").target,
  null,
);

console.log("sales target tests passed.");
