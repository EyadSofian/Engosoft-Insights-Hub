// What this feature is allowed to cost.
//
// Railway bills for a process that stays up and Odoo answers slowly under load,
// so the expensive mistakes are structural: one Odoo call per invoice, or a
// detail table that ships every audited line to a phone. Both are cheap to
// write by accident and invisible until the bill arrives, so both are asserted
// here rather than promised in a comment.
import assert from "node:assert/strict";

const { readPaymentMethods, readInvoiceLineFacts } =
  await import("../src/lib/pricing/payment-methods.server.ts");
const { summarize, buildRuleIndex, auditLine } =
  await import("../src/lib/pricing/pricing-engine.ts");

/* --- Odoo reads are batched, never per invoice ----------------------------- */

const INVOICES = 1200;
const invoiceNumbers = Array.from({ length: INVOICES }, (_, index) => `INV/2026/${index + 1}`);

let searchReadCalls = 0;
const domainSizes = [];

const fakeOdoo = {
  configured: () => true,
  metadata: async (model) =>
    model === "account.payment"
      ? {
          id: {},
          amount: {},
          state: {},
          journal_id: { type: "many2one" },
          payment_method_line_id: { type: "many2one" },
          reconciled_invoice_ids: { type: "many2many" },
        }
      : { id: {}, name: {}, invoice_payments_widget: {} },
  searchRead: async (model, domain) => {
    searchReadCalls++;
    const values = domain?.[0]?.[2] ?? [];
    domainSizes.push(values.length);
    if (model === "account.move") {
      // Ids derived from the invoice number, not from the position in the page:
      // three pages restarting at the same index would collide and make the
      // batching look broken when it is the stand-in that is.
      return values.map((name) => ({ id: 1000 + Number(name.split("/").pop()), name }));
    }
    // One payment per invoice, all settled through a Tabby journal.
    return values.map((moveId) => ({
      id: moveId,
      amount: 500,
      state: "posted",
      journal_id: [7, "Tabby SAR"],
      reconciled_invoice_ids: [moveId],
    }));
  },
};

const result = await readPaymentMethods(invoiceNumbers, {}, fakeOdoo);

assert.equal(result.reads.size, INVOICES, "every invoice gets an answer");
// Two metadata reads plus three move pages plus three payment pages. The number
// that matters is that it does not grow with the invoice count one-for-one.
assert.ok(searchReadCalls <= 8, `1,200 invoices must not become ${searchReadCalls} Odoo calls`);
assert.ok(
  searchReadCalls < INVOICES / 100,
  "the call count scales with batches, not with invoices",
);
assert.ok(
  domainSizes.every((size) => size <= 500),
  "no single request asks Odoo for an unbounded id list",
);
assert.equal(
  result.reads.get("INV/2026/1").method,
  "tabby",
  "a journal named after the provider resolves to the instrument",
);
assert.equal(result.diagnostics.invoicesRequested, INVOICES);

/* --- an unfamiliar journal is reported, not guessed ------------------------ */

{
  let calls = 0;
  const odoo = {
    ...fakeOdoo,
    searchRead: async (model, domain) => {
      calls++;
      const values = domain?.[0]?.[2] ?? [];
      if (model === "account.move") return values.map((name, index) => ({ id: index + 1, name }));
      return values.map((moveId) => ({
        id: moveId,
        amount: 100,
        state: "posted",
        journal_id: [9, "Mystery Wallet"],
        reconciled_invoice_ids: [moveId],
      }));
    },
  };
  const unknown = await readPaymentMethods(["INV/1"], {}, odoo);
  assert.equal(unknown.reads.get("INV/1").method, "unknown");
  assert.ok(
    unknown.diagnostics.unknownRawValues.includes("Mystery Wallet"),
    "the unrecognised journal is surfaced so an alias can be added",
  );
  assert.ok(calls <= 3);
}

/* --- an administrator can teach it the name -------------------------------- */

{
  const odoo = {
    ...fakeOdoo,
    searchRead: async (model, domain) => {
      const values = domain?.[0]?.[2] ?? [];
      if (model === "account.move") return values.map((name, index) => ({ id: index + 1, name }));
      return values.map((moveId) => ({
        id: moveId,
        amount: 100,
        state: "posted",
        journal_id: [9, "Mystery Wallet"],
        reconciled_invoice_ids: [moveId],
      }));
    },
  };
  const taught = await readPaymentMethods(["INV/1"], { "mystery wallet": "cash" }, odoo);
  assert.equal(taught.reads.get("INV/1").method, "cash");
}

/* --- a draft or cancelled payment settled nothing -------------------------- */

{
  const odoo = {
    ...fakeOdoo,
    searchRead: async (model, domain) => {
      const values = domain?.[0]?.[2] ?? [];
      if (model === "account.move") return values.map((name, index) => ({ id: index + 1, name }));
      return values.map((moveId) => ({
        id: moveId,
        amount: 100,
        state: "draft",
        journal_id: [7, "Tabby SAR"],
        reconciled_invoice_ids: [moveId],
      }));
    },
  };
  const draft = await readPaymentMethods(["INV/1"], {}, odoo);
  assert.equal(
    draft.reads.get("INV/1").method,
    "unknown",
    "an unposted payment is not evidence of how the customer paid",
  );
}

/* --- with Odoo unavailable, nothing is invented ---------------------------- */

{
  const offline = await readPaymentMethods(
    invoiceNumbers.slice(0, 5),
    {},
    {
      ...fakeOdoo,
      configured: () => false,
    },
  );
  assert.equal(offline.diagnostics.odooCalls, 0);
  assert.equal(offline.reads.size, 0, "no answer is better than a guessed one");
}

/* --- quantities are read in batches, and validated --------------------------- */

{
  let calls = 0;
  const sizes = [];
  const lines = Array.from({ length: 900 }, (_, index) => ({
    invoiceLineId: String(200_000 + index),
    invoiceNumber: `INVNT/2026/${index}`,
  }));
  const odoo = {
    configured: () => true,
    metadata: async () => ({
      id: {},
      move_id: {},
      product_id: {},
      quantity: {},
      price_unit: {},
      discount: {},
      price_subtotal: {},
      price_total: {},
    }),
    searchRead: async (model, domain) => {
      calls++;
      const ids = domain?.[0]?.[2] ?? [];
      sizes.push(ids.length);
      return ids.map((id) => ({
        id,
        // Two of them claim to belong to a different invoice than the one the
        // snapshot recorded against that line id.
        move_id: [1, id % 400 === 0 ? "SOMEONE/ELSE/1" : `INVNT/2026/${id - 200_000}`],
        product_id: [4242, "[586] CFM Exam Simulator"],
        quantity: 3,
        price_unit: 200,
        discount: 0,
        price_subtotal: 600,
        price_total: 600,
      }));
    },
  };

  const result = await readInvoiceLineFacts(lines, odoo);
  assert.ok(calls <= 3, `900 lines must not become ${calls} Odoo calls`);
  assert.ok(sizes.every((size) => size <= 500));
  assert.equal(result.rejected, 3, "a line id that resolves to another invoice is dropped");
  assert.equal(result.facts.size, 897);
  assert.equal(result.facts.get("200001").quantity, 3, "the real quantity is read, not assumed");
  assert.equal(result.facts.get("200001").odooProductId, 4242);
  assert.ok(!result.facts.has("200000"), "the mismatched line carries no borrowed quantity");

  // With Odoo unavailable it returns nothing rather than inventing a quantity.
  const offline = await readInvoiceLineFacts(lines.slice(0, 3), {
    ...odoo,
    configured: () => false,
  });
  assert.equal(offline.facts.size, 0);
  assert.equal(offline.odooCalls, 0);
}

/* --- package lineage follows invoice -> sale line -> pricelist -------------- */

{
  const odoo = {
    configured: () => true,
    metadata: async (model) => {
      if (model === "account.move.line") {
        return Object.fromEntries(
          [
            "id",
            "move_id",
            "product_id",
            "quantity",
            "price_unit",
            "discount",
            "price_subtotal",
            "price_total",
            "sale_line_ids",
          ].map((field) => [field, { type: field === "sale_line_ids" ? "many2many" : "float" }]),
        );
      }
      if (model === "sale.order.line") {
        return Object.fromEntries(
          [
            "id",
            "order_id",
            "product_id",
            "product_uom_qty",
            "price_unit",
            "discount",
            "price_subtotal",
            "pricelist_item_id",
          ].map((field) => [field, { type: "many2one" }]),
        );
      }
      if (model === "product.pricelist.item") {
        return {
          id: { type: "integer" },
          compute_price: { type: "selection" },
          fixed_price: { type: "float" },
        };
      }
      return {
        id: { type: "integer" },
        name: { type: "char" },
        pricelist_id: { type: "many2one" },
      };
    },
    searchRead: async (model) => {
      if (model === "account.move.line") {
        return [
          {
            id: 42,
            move_id: [4, "INV/PKG/1"],
            product_id: [77, "[CFM] Course"],
            quantity: 2,
            price_unit: 250,
            discount: 0,
            price_subtotal: 500,
            price_total: 575,
            sale_line_ids: [501],
          },
        ];
      }
      if (model === "sale.order.line") {
        return [
          {
            id: 501,
            order_id: [701, "SO/PKG/1"],
            product_id: [77, "[CFM] Course"],
            product_uom_qty: 2,
            price_unit: 250,
            discount: 0,
            price_subtotal: 500,
            pricelist_item_id: [801, "CFM package component"],
          },
        ];
      }
      if (model === "product.pricelist.item") {
        return [{ id: 801, compute_price: "fixed", fixed_price: 275 }];
      }
      return [{ id: 701, name: "SO/PKG/1", pricelist_id: [901, "BIM Package"] }];
    },
  };

  const result = await readInvoiceLineFacts(
    [{ invoiceLineId: "42", invoiceNumber: "INV/PKG/1" }],
    odoo,
  );
  const fact = result.facts.get("42");
  assert.equal(fact.pricingContext, "package");
  assert.equal(fact.pricelistId, 901);
  assert.equal(fact.pricelistName, "BIM Package");
  assert.equal(fact.saleOrderName, "SO/PKG/1");
  assert.equal(
    fact.expectedUnitPrice,
    275,
    "the fixed Odoo rule outranks a manual sale-line price",
  );
  assert.equal(fact.odooPricingChecked, true);
}

/* --- Engosoft training events identify the real package ------------------- */

{
  const fieldMap = (names) => Object.fromEntries(names.map((name) => [name, { type: "float" }]));
  const odoo = {
    configured: () => true,
    metadata: async (model) => {
      if (model === "account.move.line") {
        return fieldMap([
          "id",
          "move_id",
          "product_id",
          "quantity",
          "price_unit",
          "discount",
          "price_subtotal",
          "price_total",
          "sale_line_ids",
        ]);
      }
      if (model === "sale.order.line") {
        return fieldMap([
          "id",
          "order_id",
          "product_id",
          "event_id",
          "product_uom_qty",
          "price_unit",
          "discount",
          "price_subtotal",
          "pricelist_item_id",
        ]);
      }
      if (model === "product.pricelist.item") {
        return fieldMap(["id", "compute_price", "fixed_price"]);
      }
      if (model === "sale.order") return fieldMap(["id", "name", "pricelist_id"]);
      if (model === "event.event") {
        return fieldMap(["id", "is_package_event", "related_group_id"]);
      }
      if (model === "training.package.group") {
        return fieldMap(["id", "name", "display_name", "package_id"]);
      }
      return {};
    },
    searchRead: async (model) => {
      if (model === "account.move.line") {
        return [
          {
            id: 228612,
            move_id: [63108, "INVNT/2026/002294"],
            product_id: [2078, "[911] SketchUp"],
            quantity: 1,
            price_unit: 351.47,
            discount: 0,
            price_subtotal: 305.63,
            price_total: 351.47,
            sale_line_ids: [57703],
          },
          {
            id: 228616,
            move_id: [63108, "INVNT/2026/002294"],
            product_id: [1317, "[1] 3ds Max"],
            quantity: 1,
            price_unit: 327.16,
            discount: 0,
            price_subtotal: 284.49,
            price_total: 327.16,
            sale_line_ids: [57707],
          },
        ];
      }
      if (model === "sale.order.line") {
        return [
          {
            id: 57703,
            order_id: [19323, "S19279"],
            product_id: [2078, "[911] SketchUp"],
            event_id: [1437, "(E05712) SketchUp"],
            product_uom_qty: 1,
            price_unit: 940,
            discount: 62.61,
            price_subtotal: 351.47,
            pricelist_item_id: [6775, "SketchUp standalone price"],
          },
          {
            id: 57707,
            order_id: [19323, "S19279"],
            product_id: [1317, "[1] 3ds Max"],
            event_id: [1445, "(E05720) 3ds Max"],
            product_uom_qty: 1,
            price_unit: 875,
            discount: 62.61,
            price_subtotal: 327.16,
            pricelist_item_id: [6779, "3ds Max standalone price"],
          },
        ];
      }
      if (model === "product.pricelist.item") {
        return [
          { id: 6775, compute_price: "fixed", fixed_price: 940 },
          { id: 6779, compute_price: "fixed", fixed_price: 875 },
        ];
      }
      if (model === "sale.order") {
        return [{ id: 19323, name: "S19279", pricelist_id: [9, "KSA Price List (SAR)"] }];
      }
      if (model === "event.event") {
        return [
          { id: 1437, is_package_event: true, related_group_id: [61, "Evening Group"] },
          { id: 1445, is_package_event: true, related_group_id: [61, "Evening Group"] },
        ];
      }
      if (model === "training.package.group") {
        return [
          {
            id: 61,
            name: "Evening Group September 2026",
            display_name: "Evening Group September 2026",
            package_id: [5, "Interior Design Professional Track"],
          },
        ];
      }
      return [];
    },
  };

  const result = await readInvoiceLineFacts(
    [
      { invoiceLineId: "228612", invoiceNumber: "INVNT/2026/002294" },
      { invoiceLineId: "228616", invoiceNumber: "INVNT/2026/002294" },
    ],
    odoo,
  );
  const sketchup = result.facts.get("228612");
  const max = result.facts.get("228616");
  assert.equal(sketchup.pricingContext, "package");
  assert.equal(max.pricingContext, "package");
  assert.equal(sketchup.pricingContextName, "Interior Design Professional Track");
  assert.equal(sketchup.pricelistName, "KSA Price List (SAR)");
  assert.equal(
    sketchup.expectedUnitPrice,
    305.63,
    "the tax-normalized Odoo package allocation outranks the standalone fixed course price",
  );
  assert.equal(max.expectedUnitPrice, 284.49);
  assert.equal(sketchup.pricingLineageVersion, 2);
}

/* --- roll-ups stay linear -------------------------------------------------- */

{
  const index = buildRuleIndex([
    {
      id: "r1",
      priceBookId: "b",
      normalizedProductCode: "100",
      odooProductId: null,
      courseName: "c",
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
    },
  ]);
  const payment = { method: "cash", methods: ["cash"], raw: [], breakdown: [], source: "none" };
  const audits = Array.from({ length: 20_000 }, (_, i) =>
    auditLine(
      {
        invoiceLineId: `l${i}`,
        invoiceNumber: `INV/${i}`,
        moveType: "out_invoice",
        isCreditNote: false,
        saleDate: "2026-08-01",
        invoiceDate: "2026-08-01",
        paymentDate: "2026-08-02",
        salesperson: "s",
        salesTeam: "t",
        company: "c",
        country: "",
        currency: "SAR",
        productCode: "100",
        productName: "course",
        odooProductId: null,
        quantity: 1,
        untaxedTotal: 500,
        totalInCurrency: 500,
        allocatedDiscount: 0,
      },
      payment,
      index,
      { taxInclusive: true },
      { id: "b", version: 1 },
    ),
  );
  const startedAt = Date.now();
  const totals = summarize(audits);
  const elapsed = Date.now() - startedAt;
  assert.equal(totals.auditedLines, 20_000);
  assert.ok(elapsed < 1000, `summarising 20k audits took ${elapsed}ms`);
}

/* --- the detail table is paginated at the source --------------------------- */

const dbSource = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/lib/pricing/pricing-db.server.ts", import.meta.url), "utf8"),
);
assert.match(
  dbSource,
  /LIMIT \$\{limit\} OFFSET \$\{offset\}/,
  "audit rows are paginated in SQL, not sliced after loading everything",
);
assert.match(
  dbSource,
  /Math\.min\(Math\.max\(query\.limit \?\? 50, 1\), 500\)/,
  "a caller cannot ask for an unbounded page",
);
assert.match(
  dbSource,
  /count\(\*\) FILTER \(WHERE compliance_status/,
  "KPI counts are aggregated in PostgreSQL rather than in the server process",
);

const complianceSource = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/lib/pricing/compliance.server.ts", import.meta.url), "utf8"),
);
assert.match(
  complianceSource,
  /readDashboardDataset\("accounting"\)/,
  "invoice facts come from the stored accounting snapshot, not from Odoo",
);
assert.match(
  complianceSource,
  /existingFingerprints\.get\(line\.invoiceLineId\) === mark/,
  "an unchanged line is skipped instead of being judged again",
);

// Opening a page must not be able to trigger an audit: the run lives behind a
// POST that `authorizeWrite` guards.
const recalcRoute = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/routes/api/pricing.recalculate.ts", import.meta.url), "utf8"),
);
assert.ok(!/\bGET:/.test(recalcRoute), "the audit run is not reachable by a GET");
assert.match(recalcRoute, /guard\(request\)/);

console.log(
  `pricing performance: all assertions passed (${INVOICES} invoices resolved in ${searchReadCalls} Odoo calls)`,
);
