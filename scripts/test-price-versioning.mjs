// Versioning: an old invoice keeps the price it was actually sold at.
//
// This is the promise the whole feature rests on. If publishing September's
// prices moves what August's invoices are judged against, every price rise
// produces a wave of fake breaches, and the report is worse than nothing.
//
// The store enforces the invariants (a published book refuses in-place edits;
// publish and rollback are single transactions). What can be checked without a
// database is everything that decides *which* book applies, and that a stored
// verdict stays bound to the version that produced it — so that is what this
// asserts, plus the SQL that carries the rest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildRuleIndex, judgeLine, auditLine, priceBookDate } =
  await import("../src/lib/pricing/pricing-engine.ts");
const { withinWindow } = await import("../src/lib/pricing/pricing-normalize.ts");

const baseRule = (patch = {}) => ({
  id: "rule",
  priceBookId: "book",
  normalizedProductCode: "100",
  odooProductId: null,
  courseName: "Civil GIS",
  deliveryType: "recorded",
  pricingScope: "individual",
  paymentMethod: "cash",
  currency: "SAR",
  exactPrice: 600,
  minimumPrice: 480,
  maximumPrice: 600,
  validFrom: "",
  validTo: "",
  country: "",
  active: true,
  requiresReview: false,
  onHold: false,
  ...patch,
});

const line = (patch = {}) => ({
  invoiceLineId: "line-1",
  invoiceNumber: "INV/2026/0001",
  moveType: "out_invoice",
  isCreditNote: false,
  saleDate: "2026-08-15",
  invoiceDate: "2026-08-18",
  paymentDate: "2026-09-05",
  salesperson: "Sara",
  salesTeam: "KSA",
  company: "Engosoft KSA",
  country: "",
  currency: "SAR",
  productCode: "100",
  productName: "Civil - GIS - Recorded",
  odooProductId: null,
  quantity: 1,
  untaxedTotal: 480,
  totalInCurrency: 480,
  allocatedDiscount: 0,
  ...patch,
});

const cash = {
  method: "cash",
  methods: ["cash"],
  raw: [],
  breakdown: [],
  source: "account_payment",
};
const options = { taxInclusive: true };

/* --- September's prices do not change August's verdicts -------------------- */

const august = { id: "book-august", version: 1, taxInclusive: true };
const september = { id: "book-september", version: 2, taxInclusive: true };

const augustRules = buildRuleIndex([
  baseRule({ id: "aug", priceBookId: august.id, minimumPrice: 480 }),
]);
// September raises the floor to 600.
const septemberRules = buildRuleIndex([
  baseRule({
    id: "sep",
    priceBookId: september.id,
    minimumPrice: 600,
    exactPrice: 700,
    maximumPrice: 700,
  }),
]);

const soldInAugust = line({ totalInCurrency: 480 });

// Judged against its own month: fine. That is the sale that actually happened.
{
  const verdict = judgeLine(soldInAugust, cash, augustRules, options);
  assert.equal(verdict.status, "compliant");
  assert.equal(verdict.allowedMinimum, 480);
}
// Judged against next month's book it would be a breach — which is exactly the
// false accusation the version lookup exists to prevent.
{
  const wrong = judgeLine(soldInAugust, cash, septemberRules, options);
  assert.equal(wrong.status, "below_minimum");
}

// The stored row records the version that judged it, so a September publish
// leaves the August audit both readable and explainable.
{
  const stored = auditLine(soldInAugust, cash, augustRules, options, august);
  assert.equal(stored.priceBookVersion, 1);
  assert.equal(stored.complianceStatus, "compliant");
  assert.equal(stored.allowedMinimum, 480);

  const later = auditLine(
    line({ saleDate: "2026-09-20", totalInCurrency: 650 }),
    cash,
    septemberRules,
    options,
    september,
  );
  assert.equal(later.priceBookVersion, 2);
  assert.equal(later.status ?? later.complianceStatus, "compliant");
  // The two rows coexist; neither overwrote the other's numbers.
  assert.notEqual(stored.priceBookVersion, later.priceBookVersion);
  assert.notEqual(stored.allowedMinimum, later.allowedMinimum);
}

/* --- which book a sale belongs to ------------------------------------------ */

// The order date decides. An August sale invoiced in August and paid in
// September is an August sale.
assert.equal(priceBookDate(soldInAugust), "2026-08-15");
// Without an order date, the invoice date. Never the payment date: an invoice
// settled in September was still agreed at August's published price.
assert.equal(priceBookDate(line({ saleDate: "" })), "2026-08-18");
assert.notEqual(priceBookDate(line({ saleDate: "", invoiceDate: "" })), "2026-09-05");

// Effective windows, as `publishedBookForDate` applies them.
assert.equal(withinWindow("2026-08-15", "2026-08-01", "2026-08-31"), true);
assert.equal(withinWindow("2026-09-01", "2026-08-01", "2026-08-31"), false);
// An open-ended window keeps applying, which is what a book with no end date means.
assert.equal(withinWindow("2027-01-01", "2026-08-01", ""), true);
assert.equal(withinWindow("2026-07-31", "2026-08-01", ""), false);

/* --- a rule's own validity is separate from the book's --------------------- */

// An offer that closed stops applying even inside a live book.
{
  const closed = buildRuleIndex([
    baseRule({ id: "list", minimumPrice: 480 }),
    baseRule({
      id: "promo",
      pricingScope: "offer",
      exactPrice: 199,
      minimumPrice: 199,
      maximumPrice: null,
      validFrom: "2026-07-01",
      validTo: "2026-07-31",
    }),
  ]);
  assert.equal(
    judgeLine(line({ totalInCurrency: 199, saleDate: "2026-07-15" }), cash, closed, options).status,
    "compliant_offer",
  );
  assert.equal(
    judgeLine(line({ totalInCurrency: 199, saleDate: "2026-08-15" }), cash, closed, options).status,
    "expired_offer",
  );
}

/* --- what the store must guarantee ----------------------------------------- */

const store = readFileSync(
  new URL("../src/lib/pricing/pricing-db.server.ts", import.meta.url),
  "utf8",
);

// A published book cannot be edited in place. Editing produces a new version.
assert.match(store, /class PublishedBookImmutable extends Error/);
assert.match(
  store,
  /if \(str\(row\.book_status\) !== "draft"\) throw new PublishedBookImmutable\(\);/,
  "updating a row on a published book must throw, not write",
);
assert.match(
  store,
  /if \(book\.rows\[0\]\.status !== "draft"\) throw new PublishedBookImmutable\(\);/,
  "adding a row to a published book must throw too",
);

// Publish is one transaction: the new book goes live and the one it replaces is
// archived together, so no date is ever claimed by two books or by none.
const publish = store.slice(store.indexOf("export async function publishPriceBook"));
const publishBody = publish.slice(0, publish.indexOf("export async function rollbackToPriceBook"));
assert.match(publishBody, /await client\.query\("BEGIN"\)/);
assert.match(publishBody, /pg_advisory_xact_lock/);
assert.match(publishBody, /SET status = 'archived'/);
assert.match(publishBody, /SET status = 'published'/);
assert.match(publishBody, /await client\.query\("COMMIT"\)/);
assert.match(publishBody, /ROLLBACK/);
assert.ok(
  publishBody.indexOf("SET status = 'archived'") < publishBody.indexOf("COMMIT"),
  "archiving the old book happens inside the same transaction as publishing the new one",
);

// Rollback re-publishes an older version. It deletes nothing.
const rollback = store.slice(store.indexOf("export async function rollbackToPriceBook"));
const rollbackBody = rollback.slice(0, rollback.indexOf("export async function archivePriceBook"));
assert.ok(!/DELETE FROM price_books/.test(rollbackBody), "rollback must not delete a version");
assert.ok(
  !/DELETE FROM price_book_items/.test(rollbackBody),
  "rollback must not delete the prices of the version it supersedes",
);
assert.match(rollbackBody, /'rollback'/, "a rollback is recorded in the change log");

// Nothing anywhere in the store deletes an audited history.
assert.ok(
  !/DELETE FROM invoice_price_audits/.test(store),
  "audited verdicts are updated in place by line id, never deleted wholesale",
);
assert.match(
  store,
  /ON CONFLICT \(invoice_line_id\) DO UPDATE SET/,
  "re-auditing a line replaces that line's verdict only",
);

// The book a sale is judged by is chosen by its effective window, not by which
// version happens to be newest.
assert.match(store, /AND \(b\.effective_from IS NULL OR b\.effective_from <= \$1::date\)/);
assert.match(store, /AND \(b\.effective_to IS NULL OR b\.effective_to >= \$1::date\)/);

// Every change to a price is attributed and timestamped.
assert.match(store, /INSERT INTO price_change_log/);
for (const action of ["create_book", "publish", "rollback", "update", "add_item", "map_product"]) {
  assert.ok(store.includes(`'${action}'`), `the change log records "${action}"`);
}

console.log("price book versioning: all assertions passed");
