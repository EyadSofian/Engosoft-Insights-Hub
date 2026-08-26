import assert from "node:assert/strict";
import { accountingBusinessCategory } from "../src/lib/accounting-category.ts";
import { buildAccountingCourses } from "../src/lib/accounting-courses.ts";

const expectedNames = [
  ["revenue / engineering / Facility management", "CFM"],
  ["revenue / engineering / maintenance", "CMRP"],
  ["revenue / non-engineering / Management", "Management"],
  ["revenue / engineering / safety", "Management"],
  ["revenue / non-engineering / Interior", "Interior"],
  ["revenue / engineering / automotive", "Automotive Mechanical & Electrical"],
  ["revenue / non-engineering / marketing", "Digital Marketing"],
  ["revenue / Miscellaneous / website", "Company - Platform Renewal"],
  ["revenue / engineering / BIM", "BIM"],
  ["revenue / Miscellaneous / payment method", "revenue / Miscellaneous / payment method"],
  ["All / Deliveries", "All / Deliveries"],
];

for (const [raw, expected] of expectedNames) {
  assert.equal(accountingBusinessCategory(raw).label, expected, raw);
}

const row = (productCategory, product, usdPaid, movement) => ({
  productCategory,
  category: "",
  mainCategory: "",
  product,
  productCode: product.match(/^\[(.*?)\]/)?.[1] ?? "",
  quantity: 1,
  usdPaid,
  movement,
  isCreditNote: false,
  source: "",
  event: "",
  eventStage: "",
});

const grouped = buildAccountingCourses([
  row("revenue / non-engineering / Management", "[109] Management - PMP - Event", 120, "INV-1"),
  row("revenue / non-engineering / Management", "[111] Management - PRIMAVERA", 80, "INV-2"),
  row("revenue / engineering / safety", "[106] OSHA", 50, "INV-3"),
  row("revenue / engineering / Facility management", "[65] Management - CFM - Event", 300, "INV-4"),
  row("revenue / engineering / maintenance", "[66] CMRP - Recorded", 90, "INV-5"),
  row("revenue / non-engineering / Interior", "[1] Interior Design - 3ds Max", 125, "INV-6"),
]);

assert.equal(grouped.summary.families, 4, "top-level rows must be Product Categories");
assert.equal(grouped.summary.revenueUsd, 765);
const management = grouped.families.find((item) => item.family === "Management");
assert.ok(management);
assert.equal(management.revenueUsd, 250, "Management includes Management and Safety workbook rows");
assert.equal(management.invoices, 3);
assert.equal(management.products.length, 3, "PMP, Primavera and Safety remain auditable products");
assert.deepEqual(
  grouped.families.map((item) => item.family),
  ["CFM", "Management", "Interior", "CMRP"],
  "categories sort by paid revenue",
);

console.log("accounting category grouping: all assertions passed");
