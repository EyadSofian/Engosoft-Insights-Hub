import assert from "node:assert/strict";
import { applyOverrides } from "../src/lib/target-overrides.ts";
import { SALES_TARGETS, targetsByPerson } from "../src/lib/sales-targets.ts";
import { normalizePersonName } from "../src/lib/person-name.ts";

const override = (employeeId, target, month = "2026-08") => ({
  month,
  employeeId,
  target,
  note: "",
  updatedAt: "2026-08-16T12:00:00.000Z",
  updatedBy: "test",
});

const totalFor = (source, month) => source[month].reduce((sum, row) => sum + (row.target ?? 0), 0);

/* --- an edit is a delta, not a replacement --------------------------------- */
// A save that mentions one person must not disturb the rest of the roster. This
// is what stops a dropped or half-filled request from wiping the month.
{
  const merged = applyOverrides(SALES_TARGETS, [override("346", 12000)]);
  assert.equal(merged["2026-08"].length, SALES_TARGETS["2026-08"].length, "roster unchanged");
  assert.equal(merged["2026-08"].find((r) => r.employeeId === "346").target, 12000);
  // Everyone else keeps the published quota: only Sherif's 9,000 → 12,000 moved.
  assert.equal(totalFor(merged, "2026-08"), 135_276 + 3000);
}

/* --- the seed is never mutated --------------------------------------------- */
{
  applyOverrides(SALES_TARGETS, [override("346", 1)]);
  assert.equal(
    SALES_TARGETS["2026-08"].find((r) => r.employeeId === "346").target,
    9000,
    "applying an override must not edit the module constant in place",
  );
}

/* --- null and zero stay different ------------------------------------------ */
// Clearing a quota means "publishes none" (an em dash). Typing 0 means a real
// zero. Collapsing the two would either invent a target or hide one.
{
  const cleared = applyOverrides(SALES_TARGETS, [override("346", null)]);
  assert.equal(cleared["2026-08"].find((r) => r.employeeId === "346").target, null);

  const zeroed = applyOverrides(SALES_TARGETS, [override("346", 0)]);
  assert.equal(zeroed["2026-08"].find((r) => r.employeeId === "346").target, 0);
}

/* --- an untargeted person can be given a quota ----------------------------- */
// Maternity leave ends; Operation takes on a quota. The entry already exists in
// the roster, so this is an update, not an insert.
{
  const merged = applyOverrides(SALES_TARGETS, [override("457", 5000)]);
  const row = merged["2026-08"].find((r) => r.employeeId === "457");
  assert.equal(row.target, 5000);
  assert.equal(row.name, "Mennatallah walid", "Odoo identity is kept from the seed");
  assert.equal(merged["2026-08"].length, SALES_TARGETS["2026-08"].length);
}

/* --- a new month is created, not merged into an existing one --------------- */
{
  const merged = applyOverrides(SALES_TARGETS, [override("346", 9500, "2026-09")]);
  assert.equal(merged["2026-09"].length, 1, "September holds only what was saved");
  assert.equal(merged["2026-09"][0].target, 9500);
  assert.equal(merged["2026-09"][0].name, "Sherif Waleed Ahmed Mohamed", "identity reused");
  // The aliases come with it, so the Odoo spelling still resolves next month.
  const people = targetsByPerson(merged);
  assert.equal(
    people.byName.get(normalizePersonName("Sherif Waleed Ahmed Mohamed")).entry.employeeId,
    "346",
  );
  assert.equal(totalFor(merged, "2026-08"), 135_276, "August untouched");
}

// An alias declared in the seed survives into an edited month, so a renamed
// employee does not silently lose their quota after an edit.
{
  const merged = applyOverrides(SALES_TARGETS, [override("378", 7000, "2026-09")]);
  const people = targetsByPerson(merged);
  assert.equal(people.byName.get(normalizePersonName("AHMED FAROUK")).entry.employeeId, "378");
}

/* --- no overrides is a no-op ----------------------------------------------- */
assert.equal(applyOverrides(SALES_TARGETS, []), SALES_TARGETS);

console.log("target override tests passed.");
