// The compliance engine.
//
// Half of these cases assert that something is *not* called a breach. That is
// the expensive half: a report that accuses a salesperson because a product was
// renamed, or because a payment journal is unfamiliar, gets switched off within
// a week and never comes back.
import assert from "node:assert/strict";

const {
  buildRuleIndex,
  judgeLine,
  allocateInvoiceDiscounts,
  actualUnitPrice,
  priceBookDate,
  widestBand,
  summarize,
  auditLine,
} = await import("../src/lib/pricing/pricing-engine.ts");

let ruleSeq = 0;
const rule = (patch = {}) => ({
  id: `rule-${++ruleSeq}`,
  priceBookId: "book-1",
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

let lineSeq = 0;
const line = (patch = {}) => ({
  invoiceLineId: `line-${++lineSeq}`,
  invoiceNumber: "INV/2026/0001",
  moveType: "out_invoice",
  isCreditNote: false,
  saleDate: "2026-08-15",
  invoiceDate: "2026-08-15",
  paymentDate: "2026-09-01",
  salesperson: "Sara",
  salesTeam: "KSA",
  company: "Engosoft KSA",
  country: "Saudi Arabia",
  currency: "SAR",
  productCode: "100",
  productName: "Civil - GIS - Recorded",
  odooProductId: null,
  quantity: 1,
  untaxedTotal: 500,
  totalInCurrency: 500,
  allocatedDiscount: 0,
  pricingContext: "individual",
  pricingContextName: "",
  odooPricingChecked: true,
  odooSaleOrderLineId: null,
  odooSaleOrderId: null,
  odooSaleOrderName: "",
  odooPricelistId: null,
  odooPricelistName: "",
  odooPricelistItemId: null,
  odooPricelistItemName: "",
  odooExpectedUnitPrice: null,
  ...patch,
});

const paid = (method, extra = {}) => ({
  method,
  methods: method === "unknown" ? [] : [method],
  raw: [method],
  breakdown: [],
  source: "account_payment",
  ...extra,
});

const options = { taxInclusive: true };
const judge = (rules, invoiceLine, payment = paid("cash")) =>
  judgeLine(invoiceLine, payment, buildRuleIndex(rules), options);

/* --- the price band -------------------------------------------------------- */

// Inside the band.
assert.equal(judge([rule()], line({ totalInCurrency: 520 })).status, "compliant");
// Exactly on the floor is compliant: the floor is a price a seller may agree to.
assert.equal(judge([rule()], line({ totalInCurrency: 480 })).status, "compliant");
// Under it is not.
{
  const verdict = judge([rule()], line({ totalInCurrency: 400 }));
  assert.equal(verdict.status, "below_minimum");
  assert.equal(verdict.allowedMinimum, 480);
  assert.equal(verdict.varianceAmount, 80);
  assert.equal(Math.round(verdict.variancePercent * 1000) / 1000, 0.167);
  assert.equal(verdict.severity, "critical", "17% under the floor is critical");
}
// A small discount is a warning, not a critical finding.
assert.equal(judge([rule()], line({ totalInCurrency: 460 })).severity, "warning");
// Above list is information, never a breach.
{
  const verdict = judge([rule()], line({ totalInCurrency: 900 }));
  assert.equal(verdict.status, "above_list");
  assert.equal(verdict.severity, "informational");
  assert.equal(verdict.leakageAmount, 0);
}

/* --- payment methods price differently ------------------------------------- */

const cashRule = rule({
  paymentMethod: "cash",
  exactPrice: 480,
  minimumPrice: 480,
  maximumPrice: null,
});
const tabbyRule = rule({
  paymentMethod: "tabby",
  exactPrice: 600,
  minimumPrice: 600,
  maximumPrice: null,
});

// 480 is the published cash price and a 120 shortfall on Tabby. Same invoice
// value, different verdict, decided only by what settled the invoice.
assert.equal(
  judge([cashRule, tabbyRule], line({ totalInCurrency: 480 }), paid("cash")).status,
  "compliant",
);
{
  const verdict = judge([cashRule, tabbyRule], line({ totalInCurrency: 480 }), paid("tabby"));
  assert.equal(verdict.status, "below_minimum");
  assert.equal(verdict.allowedMinimum, 600);
}

// An unreadable payment is never judged. It is a gap in the evidence.
{
  const verdict = judge([cashRule, tabbyRule], line({ totalInCurrency: 100 }), paid("unknown"));
  assert.equal(verdict.status, "unknown_payment_method");
  assert.equal(verdict.severity, "needs_review");
  assert.equal(verdict.leakageAmount, 0);
}

// Mixed instruments settle into one verdict only when they price identically.
{
  const sameBand = [
    rule({ paymentMethod: "cash", minimumPrice: 480, maximumPrice: 600 }),
    rule({ paymentMethod: "cashier", minimumPrice: 480, maximumPrice: 600 }),
  ];
  const verdict = judge(
    sameBand,
    line({ totalInCurrency: 500 }),
    paid("mixed", { methods: ["cash", "cashier"] }),
  );
  assert.equal(verdict.status, "compliant", "two instruments in one band can be judged");
}
{
  const verdict = judge(
    [cashRule, tabbyRule],
    line({ totalInCurrency: 400 }),
    paid("mixed", { methods: ["cash", "tabby"] }),
  );
  assert.equal(verdict.status, "mixed_payment_review");
  assert.equal(verdict.severity, "needs_review");
  assert.equal(verdict.leakageAmount, 0, "an undecidable case never counts as leakage");
}

/* --- matching -------------------------------------------------------------- */

// No confirmed match is neither compliant nor a breach.
{
  const verdict = judge([rule({ normalizedProductCode: "999" })], line({ totalInCurrency: 10 }));
  assert.equal(verdict.status, "unmatched_product");
  assert.equal(verdict.severity, "needs_review");
  assert.equal(verdict.leakageAmount, 0);
}

// A product id outranks a code, and the verdict records which was used.
{
  const index = buildRuleIndex([
    rule({ odooProductId: 4242, normalizedProductCode: "", minimumPrice: 300, maximumPrice: 900 }),
    rule({ normalizedProductCode: "100", minimumPrice: 480 }),
  ]);
  const verdict = judgeLine(
    line({ odooProductId: 4242, totalInCurrency: 350 }),
    paid("cash"),
    index,
    options,
  );
  assert.equal(verdict.matchType, "odoo_product_id");
  assert.equal(verdict.status, "compliant");
}

// An approved manual link is used; an unapproved one is not.
{
  const target = rule({ normalizedProductCode: "", minimumPrice: 480 });
  const approved = buildRuleIndex(
    [target],
    [
      {
        priceItemId: target.id,
        odooProductId: 77,
        odooProductCode: "",
        matchType: "manual",
        confidence: 1,
        approvedBy: "eyad",
        approvedAt: "",
      },
    ],
  );
  assert.equal(
    judgeLine(
      line({ odooProductId: 77, productCode: "", totalInCurrency: 500 }),
      paid("cash"),
      approved,
      options,
    ).matchType,
    "manual",
  );
  const unapproved = buildRuleIndex(
    [target],
    [
      {
        priceItemId: target.id,
        odooProductId: 77,
        odooProductCode: "",
        matchType: "manual",
        confidence: 1,
        approvedBy: "",
        approvedAt: "",
      },
    ],
  );
  assert.equal(
    judgeLine(
      line({ odooProductId: 77, productCode: "", totalInCurrency: 100 }),
      paid("cash"),
      unapproved,
      options,
    ).status,
    "unmatched_product",
    "a link nobody approved does not match",
  );
}

// A sale in one currency is never judged against a price published in another.
{
  const verdict = judge(
    [rule({ currency: "EGP", minimumPrice: 5000 })],
    line({ currency: "SAR", totalInCurrency: 500 }),
  );
  assert.equal(verdict.status, "unmatched_product");
  assert.match(verdict.reason, /own currency/);
}

/* --- offers ---------------------------------------------------------------- */

const listRule = rule({ paymentMethod: "cash", minimumPrice: 480, maximumPrice: 600 });
const offer = rule({
  pricingScope: "offer",
  paymentMethod: "cash",
  exactPrice: 199,
  minimumPrice: 199,
  maximumPrice: null,
  validFrom: "2026-08-01",
  validTo: "2026-08-31",
});

// Below list but inside a live offer.
{
  const verdict = judge([listRule, offer], line({ totalInCurrency: 199, saleDate: "2026-08-15" }));
  assert.equal(verdict.status, "compliant_offer");
  assert.equal(verdict.leakageAmount, 0);
}
// The same price after the offer closed is not a pass — but it is not silently
// a plain breach either; the reason names the offer.
{
  const verdict = judge([listRule, offer], line({ totalInCurrency: 199, saleDate: "2026-09-15" }));
  assert.equal(verdict.status, "expired_offer");
  assert.equal(verdict.severity, "needs_review");
  assert.match(verdict.reason, /2026-08-31/);
}
// An unpublished offer excuses nothing.
{
  const verdict = judge(
    [listRule, rule({ ...offer, id: "offer-draft", active: false })],
    line({ totalInCurrency: 199, saleDate: "2026-08-15" }),
  );
  assert.equal(verdict.status, "below_minimum");
}
// An offer for a different instrument does not excuse this one.
{
  const verdict = judge(
    [tabbyRule, { ...offer, id: "offer-cash", paymentMethod: "cash" }],
    line({ totalInCurrency: 199, saleDate: "2026-08-15" }),
    paid("tabby"),
  );
  assert.equal(verdict.status, "below_minimum");
}

/* --- quantity, tax and discounts ------------------------------------------- */

// The comparison is per unit, not per line total.
assert.equal(judge([listRule], line({ quantity: 3, totalInCurrency: 1500 })).status, "compliant");
{
  const verdict = judge([listRule], line({ quantity: 3, totalInCurrency: 1200 }));
  assert.equal(verdict.status, "below_minimum");
  assert.equal(verdict.actualUnitPrice, 400);
  assert.equal(verdict.varianceAmount, 80);
  assert.equal(verdict.leakageAmount, 240, "the gap is multiplied by quantity");
}

// A tax-exclusive book compares against the untaxed total.
assert.equal(actualUnitPrice(line({ untaxedTotal: 400, totalInCurrency: 460 }), false), 400);
assert.equal(actualUnitPrice(line({ untaxedTotal: 400, totalInCurrency: 460 }), true), 460);

// An invoice-level discount line is spread across the courses it discounts, by
// value — not applied to one of them, and not ignored.
{
  const invoice = [
    line({ invoiceLineId: "a", totalInCurrency: 600, untaxedTotal: 600 }),
    line({ invoiceLineId: "b", totalInCurrency: 400, untaxedTotal: 400 }),
    line({
      invoiceLineId: "d",
      productName: "Discount",
      totalInCurrency: -100,
      untaxedTotal: -100,
    }),
  ];
  const allocated = allocateInvoiceDiscounts(invoice, true);
  assert.equal(allocated[0].allocatedDiscount, 60);
  assert.equal(allocated[1].allocatedDiscount, 40);
  assert.equal(allocated[2].allocatedDiscount, 0);
  assert.equal(actualUnitPrice(allocated[0], true), 540);
}
// Shipping and certificate lines neither absorb a discount nor act as one.
{
  const invoice = [
    line({ invoiceLineId: "a", totalInCurrency: 600, untaxedTotal: 600 }),
    line({
      invoiceLineId: "s",
      productName: "Shipping KSA Certificates",
      totalInCurrency: 250,
      untaxedTotal: 250,
    }),
    line({
      invoiceLineId: "d",
      productName: "Discount",
      totalInCurrency: -100,
      untaxedTotal: -100,
    }),
  ];
  const allocated = allocateInvoiceDiscounts(invoice, true);
  assert.equal(allocated[0].allocatedDiscount, 100, "the whole discount lands on the course");
  assert.equal(allocated[1].allocatedDiscount, 0, "shipping keeps its own price");
}

/* --- packages -------------------------------------------------------------- */

// The same course can be worth 600 alone and 250 as one component of a package.
// Odoo's linked sale line is the authority for the package component, so the
// standalone price must not manufacture a critical finding.
{
  const verdict = judge(
    [rule({ minimumPrice: 600, maximumPrice: 600 })],
    line({
      pricingContext: "package",
      pricingContextName: "BIM Complete Package",
      odooPricelistId: 17,
      odooPricelistName: "BIM Complete Package",
      odooExpectedUnitPrice: 250,
      untaxedTotal: 250,
      totalInCurrency: 287.5,
    }),
  );
  assert.equal(verdict.status, "compliant_package");
  assert.equal(verdict.allowedMinimum, 250);
  assert.equal(verdict.leakageAmount, 0);
  assert.equal(verdict.matchType, "odoo_pricelist");
}

// A genuine reduction below the package component price is still a finding.
{
  const verdict = judge(
    [rule({ minimumPrice: 600 })],
    line({
      pricingContext: "package",
      odooPricelistName: "BIM Complete Package",
      odooExpectedUnitPrice: 250,
      untaxedTotal: 200,
      totalInCurrency: 230,
    }),
  );
  assert.equal(verdict.status, "below_minimum");
  assert.equal(verdict.allowedMinimum, 250);
  assert.equal(verdict.varianceAmount, 50);
}

// Missing package lineage is neutral, never a guessed standalone breach.
{
  const unresolved = judge(
    [rule({ minimumPrice: 600 })],
    line({
      pricingContext: "package",
      pricingContextName: "BIM Complete Package",
      odooExpectedUnitPrice: null,
      untaxedTotal: 200,
      totalInCurrency: 230,
    }),
  );
  assert.equal(unresolved.status, "package_price_unresolved");
  assert.equal(unresolved.severity, "none");
  assert.equal(unresolved.leakageAmount, 0);
}

// For an older invoice with no sale-line link, the existence of a package rule
// is enough to pause the accusation until Odoo resolves the context.
{
  const verdict = judge(
    [
      rule({ pricingScope: "individual", minimumPrice: 600 }),
      rule({ pricingScope: "bundle", minimumPrice: 1500, exactPrice: 1500 }),
    ],
    line({ pricingContext: "unknown", totalInCurrency: 250 }),
  );
  assert.equal(verdict.status, "package_price_unresolved");
  assert.equal(verdict.severity, "none");
}

// A package with its own code is compared against the package price directly,
// not spread across the courses inside it.
{
  const packageRule = rule({
    normalizedProductCode: "PKG-BIM",
    pricingScope: "bundle",
    paymentMethod: "cash",
    exactPrice: 1250,
    minimumPrice: 1250,
    maximumPrice: null,
  });
  const verdict = judge([packageRule], line({ productCode: "PKG-BIM", totalInCurrency: 1250 }));
  assert.equal(verdict.status, "compliant");
  assert.equal(
    judge([packageRule], line({ productCode: "PKG-BIM", totalInCurrency: 900 })).status,
    "below_minimum",
  );
}
// When a code prices both a course and a package, the course price wins — and
// the package's higher price never becomes a floor the seller has to reach.
{
  const both = [
    rule({
      pricingScope: "individual",
      paymentMethod: "cash",
      minimumPrice: 480,
      maximumPrice: 600,
    }),
    rule({ pricingScope: "bundle", paymentMethod: "cash", exactPrice: 1250, minimumPrice: 1250 }),
  ];
  const verdict = judge(both, line({ totalInCurrency: 500 }));
  assert.equal(verdict.status, "compliant");
  assert.equal(verdict.allowedMinimum, 480);
}

/* --- duplicated rules ------------------------------------------------------ */

// Two published rows that disagree: the seller is judged against the widest
// band the company published, so a mistake in the price list is not their fault.
{
  const band = widestBand([
    rule({ minimumPrice: 300, maximumPrice: 300, exactPrice: 300 }),
    rule({ minimumPrice: 200, maximumPrice: 250, exactPrice: 250 }),
  ]);
  assert.equal(band.minimum, 200);
  assert.equal(band.maximum, 300);
  const verdict = judge(
    [
      rule({ minimumPrice: 300, maximumPrice: 300 }),
      rule({ minimumPrice: 200, maximumPrice: 250 }),
    ],
    line({ totalInCurrency: 220 }),
  );
  assert.equal(verdict.status, "compliant");
}

/* --- things that are not sales --------------------------------------------- */

// A credit note is a return, shown separately, never a discount breach.
{
  const verdict = judge([listRule], line({ isCreditNote: true, totalInCurrency: -500 }));
  assert.equal(verdict.status, "excluded");
  assert.equal(verdict.severity, "none");
}
// A free or bonus line is excluded and flagged, not accused.
assert.equal(judge([listRule], line({ totalInCurrency: 0 })).status, "excluded");
assert.equal(
  judge([listRule], line({ productName: "Free bonus workshop", totalInCurrency: 1 })).status,
  "excluded",
);
// A zero-quantity line cannot produce a unit price.
assert.equal(judge([listRule], line({ quantity: 0 })).status, "excluded");

// A suspended product that was sold anyway is called out in the reason.
{
  const verdict = judge([rule({ onHold: true })], line({ totalInCurrency: 500 }));
  assert.match(verdict.reason, /on hold/i);
}

/* --- which price book applies ---------------------------------------------- */

// The order date decides, then the invoice date. The payment date never does.
assert.equal(
  priceBookDate(
    line({ saleDate: "2026-08-01", invoiceDate: "2026-08-20", paymentDate: "2026-09-30" }),
  ),
  "2026-08-01",
);
assert.equal(
  priceBookDate(line({ saleDate: "", invoiceDate: "2026-08-20", paymentDate: "2026-09-30" })),
  "2026-08-20",
);
assert.notEqual(
  priceBookDate(line({ saleDate: "", invoiceDate: "", paymentDate: "2026-09-30" })),
  "2026-09-30",
);

/* --- roll-up --------------------------------------------------------------- */

{
  const book = { id: "book-1", version: 3 };
  const index = buildRuleIndex([listRule]);
  const audits = [
    auditLine(line({ totalInCurrency: 500 }), paid("cash"), index, options, book),
    auditLine(line({ totalInCurrency: 400 }), paid("cash"), index, options, book),
    auditLine(
      line({ productCode: "zzz", totalInCurrency: 400 }),
      paid("cash"),
      index,
      options,
      book,
    ),
    auditLine(line({ totalInCurrency: 500 }), paid("unknown"), index, options, book),
    auditLine(
      line({ isCreditNote: true, totalInCurrency: -500 }),
      paid("cash"),
      index,
      options,
      book,
    ),
  ];
  const totals = summarize(audits);
  assert.equal(totals.auditedLines, 5);
  assert.equal(totals.excludedLines, 1, "the credit note is not part of the population");
  assert.equal(totals.eligibleLines, 4);
  assert.equal(totals.matchedLines, 3);
  assert.equal(Math.round(totals.coverage * 100) / 100, 0.75);
  assert.equal(totals.judgedLines, 2);
  // Neither an unmatched product nor an unknown payment method is a pricing
  // verdict. Both stay visible as data-quality findings without lowering the rate.
  assert.equal(totals.complianceRate, 0.5);
  assert.equal(totals.unknownPaymentLines, 1);
  assert.equal(totals.belowMinimumLines, 1);
  assert.equal(totals.belowMinimumValue, 80);
  assert.deepEqual(totals.byCurrencyLeakage, { SAR: 80 });
  // The stored row carries the version that judged it.
  assert.equal(audits[0].priceBookVersion, 3);
}

console.log("pricing engine: all assertions passed");
