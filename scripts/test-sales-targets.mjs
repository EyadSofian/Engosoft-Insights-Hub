import assert from "node:assert/strict";
import {
  SALES_TARGETS,
  daysInMonth,
  isTargetMonth,
  monthCoverage,
  monthsInWindow,
  targetIndexForMonth,
  targetRosterForMonth,
  targetsByPerson,
  windowTarget,
} from "../src/lib/sales-targets.ts";
import { normalizePersonName } from "../src/lib/person-name.ts";

const MONTH = "2026-08";
const august = SALES_TARGETS[MONTH];

/* --- the workbook's own totals must survive transcription ------------------ */

const sum = (rows) => rows.reduce((total, row) => total + (row.target ?? 0), 0);
const byLeader = (leader) => august.filter((row) => row.teamLeader === leader);

assert.equal(august.length, 35, "the published roster plus the September starter is represented");
assert.equal(
  august.filter((row) => row.target !== null).length,
  22,
  "only employees with a published number carry a target",
);
assert.equal(sum(august), 135_276, "GRAND TOTAL — ALL EMPLOYEES");
assert.equal(sum(byLeader("Bahaa Ramdan")), 57_276, "Subtotal — Bahaa Ramdan");
assert.equal(sum(byLeader("Ahmed Saeed")), 10_000, "Subtotal - Ahmed saeed");
assert.equal(sum(byLeader("Hady Mahmoud Fahmy")), 12_677, "Subtotal — Hady mahmoud fahmy");
assert.equal(sum(byLeader("Nader Aziz")), 40_000, "Subtotal — Nader Aziz");
assert.equal(sum(byLeader("Asmaa Fathy")), 5_323, "Subtotal — Asmaa Fathy");
assert.equal(sum(byLeader("Mahfouz Afify")), 10_000, "Total Target Saudi Brunch");
assert.equal(sum(byLeader("Operation")), 0, "Operation carries no quota");
assert.equal(sum(byLeader("Website")), 0, "Direct website salesperson has no personal quota");

// The workbook's own supervisor rollups.
const bySupervisor = (name) => august.filter((row) => row.supervisor === name);
assert.equal(sum(bySupervisor("Bahaa Ramadan")), 79_953, "Total Target Bahaa");
assert.equal(sum(bySupervisor("Asmaa Fathy")), 45_323, "Total Target Asmaa");

/* --- a blank target is not a zero ------------------------------------------ */

const onLeave = august.find((row) => row.employeeId === "457");
assert.equal(onLeave.target, null, "maternity leave publishes no target");
assert.equal(onLeave.note, "أجازة وضع");

const teamLeader = august.find((row) => row.employeeId === "418");
assert.equal(teamLeader.target, null, "the updated sheet publishes no personal quota for Nader");

assert.equal(
  august.filter((row) => row.target === null).length,
  13,
  "every blank target in the updated first sheet remains deliberately untargeted",
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
assert.equal(resolve("Ahmed El-Shiekh")?.employeeId, "292");
// Operation staff resolve too, so they read as "untargeted", not "no target".
assert.equal(resolve("Ahmed Hesham")?.employeeId, "303");
assert.equal(resolve("Abdulrahman Adel")?.employeeId, "417");
assert.equal(resolve("mennaallah magdy")?.employeeId, "399");
assert.equal(resolve("Asmaa Fathy")?.employeeId, "350");
assert.equal(resolve("Amira Muhammad Salah al-Din Awad")?.employeeId, "381");
assert.equal(resolve("Mohamed Ehab Fathy")?.employeeId, "597");
assert.equal(resolve("محمد إيهاب فتحي")?.employeeId, "597");

assert.equal(resolve("Abdullah Mohsen Abdul Hamid")?.employeeId, "335");
assert.equal(resolve("Ahmed Farouk Mohamed Mohamed")?.employeeId, "378");
assert.equal(resolve("mahmoud hassan elsayed amer")?.employeeId, "632");
assert.equal(resolve("Ahmed Shaaban Ali Muhammad")?.employeeId, "292");
// The workbook spelling has to keep working too.
assert.equal(resolve("mahmoud hassan elsayed amer (website)")?.employeeId, "632");
assert.equal(resolve("Direct Website")?.employeeId, "381");
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

/* --- preparing the next monthly roster ------------------------------------ */

assert.equal(isTargetMonth("2026-09"), true);
assert.equal(isTargetMonth("2026-13"), false);
assert.equal(isTargetMonth("August"), false);

const septemberDraft = targetRosterForMonth("2026-09");
assert.equal(septemberDraft.exists, false, "September begins as a new monthly draft");
assert.equal(septemberDraft.basisMonth, "2026-08", "new months copy the latest earlier roster");
assert.equal(
  septemberDraft.rows.length,
  august.length,
  "the whole team is copied, not one employee",
);
assert.notEqual(
  septemberDraft.rows[0],
  august[0],
  "draft editing cannot mutate historic August rows",
);
septemberDraft.rows[0].target = 1;
assert.notEqual(august[0].target, 1, "August remains immutable while September is prepared");

const existingAugust = targetRosterForMonth("2026-08");
assert.equal(existingAugust.exists, true);
assert.equal(existingAugust.basisMonth, "2026-08");

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

/* --- the quota is the quota ------------------------------------------------ */

const monthly = [{ month: "2026-08", target: 9000 }];

const wholeMonth = windowTarget(monthly, "2026-08-01", "2026-08-31");
assert.equal(wholeMonth.target, 9000);
assert.equal(wholeMonth.complete, true);

// The reported case: Sherif Waleed on 16 August 2026. The page showed
// $4,645.16 as "the target" and 141.5% achievement, for someone who had
// collected $6,573.18 of a $9,000 quota. A quota does not shrink because the
// month is half over, so a partial window returns the whole number.
const midMonth = windowTarget(monthly, "2026-08-01", "2026-08-16");
assert.equal(midMonth.target, 9000, "the published quota is never scaled by elapsed days");

const collected = 6573.18;
assert.equal(
  Number(((collected / midMonth.target) * 100).toFixed(1)),
  73.0,
  "the honest answer, whatever part of the month is selected",
);

// Year to date: only August publishes a quota, so the comparison covers part of
// the window and must say so.
const ytd = windowTarget(monthly, "2026-01-01", "2026-08-31");
assert.equal(ytd.target, 9000);
assert.equal(ytd.complete, false);
assert.equal(ytd.monthsMissing.length, 7);

// A window entirely outside the published months yields no quota at all, rather
// than a zero that would read as "achieved nothing".
const outside = windowTarget(monthly, "2026-09-01", "2026-09-30");
assert.equal(outside.target, null);
assert.equal(outside.monthsCovered.length, 0);

// An untargeted employee stays untargeted whatever the window.
assert.equal(
  windowTarget([{ month: "2026-08", target: null }], "2026-08-01", "2026-08-31").target,
  null,
);

console.log("sales target tests passed.");
