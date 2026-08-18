import assert from "node:assert/strict";
import { archivedWinFilter, isArchivedWonStage } from "../src/lib/archived-won.ts";

/**
 * Winning a deal in Odoo ends with the record archived. It leaves the active
 * CRM export and lands in the archived tab still carrying `stage = Won`.
 *
 * Those rows were kept out of Lost — correctly — but nothing put them into Won,
 * so the win simply vanished. Campaign `Bim - 6/7/26 - CBO - SH` reported 0
 * wins and a 0.00% close rate beside its own two paid invoices and $667.63
 * collected, while Odoo's dashboard reported 2 Closed Won for that campaign and
 * month.
 */

const crmLead = (id, isWon = false) => ({ id, isWon });
const archived = (id, stage) => ({ id, stage });

/** The two counters every aggregation site runs over the archived population. */
const wins = (crm, rows) => rows.filter(archivedWinFilter(crm));
const losses = (rows) => rows.filter((row) => !isArchivedWonStage(row.stage));

/* --- an archived Won row is a win, and is not also a loss ------------------ */
{
  const crm = [crmLead("1"), crmLead("2")];
  const rows = [archived("10", "Won"), archived("11", "Won"), archived("12", "Lost")];

  assert.equal(wins(crm, rows).length, 2, "both archived Won rows are wins");
  assert.equal(losses(rows).length, 1, "and neither of them is a loss");
}

/* --- stage text is matched the way Odoo actually writes it ----------------- */
{
  const rows = [archived("10", " won "), archived("11", "WON")];
  assert.equal(
    wins([], rows).length,
    2,
    "casing and stray whitespace in the stage column must not cost a win",
  );
}

/**
 * The exact stage vocabulary of the live pipeline, read from a July export of
 * the archive (5,511 rows) and the CRM tab (18,380 rows). The Won stage is
 * bilingual, and only the CRM tab has a `Cleaned Stage` column that reduces it
 * to `Won` — which is why a bare `=== "won"` test found every win on one tab
 * and none on the other. All 12 archived wins in that export read `Won / ربح`.
 */
{
  const LIVE_STAGES = [
    "Contact",
    "Lost Verification",
    "Fresh",
    "Interested / مهتم ( sales )",
    "Postponed",
    "Awareness",
    "old data",
    "Quotation / عرض سعر",
    "Not Reached",
    "No Communication",
    "Old Auto Dialer",
    "Wrong Number",
    "Re-assign",
    "Technical Proposal ( presales )",
    "Retention / إعادة شراء",
    "Won / ربح",
  ];
  const won = LIVE_STAGES.filter(isArchivedWonStage);
  assert.deepEqual(won, ["Won / ربح"], "exactly one live stage is the Won stage");

  const rows = LIVE_STAGES.map((stage, i) => archived(String(i), stage));
  assert.equal(wins([], rows).length, 1);
  assert.equal(losses(rows).length, LIVE_STAGES.length - 1, "every other stage stays a loss");
}

/* --- either half of the bilingual label is enough -------------------------- */
{
  // The archive falls back to the raw label when `Cleaned Stage` is blank, and
  // the halves have been seen in both orders.
  for (const stage of ["Won / ربح", "ربح / Won", "Won", "ربح"])
    assert.equal(isArchivedWonStage(stage), true, `${stage} is a win`);
}

/* --- a deal in both exports is one win, not two ---------------------------- */
{
  // A record archived between the CRM read and the archive read appears in
  // both. The CRM side already counted it, so the archive must not count it
  // again.
  assert.equal(wins([crmLead("7", true)], [archived("7", "Won")]).length, 0);

  // But an id that merely exists in CRM is not a claim on the win. Only a CRM
  // row already counted as Won suppresses the archived one.
  assert.equal(wins([crmLead("7", false)], [archived("7", "Won")]).length, 1);
}

/* --- an id-less archived Won row is still a win ---------------------------- */
{
  // Blank ids cannot identify a duplicate, and dropping an unidentified win is
  // the worse error of the two.
  assert.equal(wins([crmLead("", true)], [archived("", "Won")]).length, 1);
}

/* --- losses and blanks are untouched --------------------------------------- */
{
  const rows = [archived("10", "Lost"), archived("11", "")];
  assert.equal(wins([], rows).length, 0);
  assert.equal(losses(rows).length, 2, "a blank stage is not a win");
}

console.log("archived won tests passed.");
