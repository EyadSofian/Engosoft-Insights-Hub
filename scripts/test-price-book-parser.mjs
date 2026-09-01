// The workbook parser, checked against the real Engosoft price list.
//
// Every assertion here is a mistake that would be invisible in the UI: a course
// silently deleted because its code repeats, a suspended product priced at zero,
// a package price filed as a course price, or a WhatsApp broadcast published as
// an approved price.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const { readXlsx } = await import("../src/lib/pricing/xlsx-reader.server.ts");
const { parsePriceWorkbook, detectLayout } =
  await import("../src/lib/pricing/price-book-parser.ts");
const {
  priceCell,
  isNullToken,
  isHoldToken,
  normalizeDeliveryType,
  normalizeProductCode,
  isCompositeCode,
  readAmbiguousDate,
  parsePricePhrases,
} = await import("../src/lib/pricing/pricing-normalize.ts");

/* --- value normalization (no file needed) ---------------------------------- */

// An absent price is absent. Reading it as zero would make every one of these
// courses look like it may be given away.
for (const blank of ["", "____", "__", "Not Available", "not available", "N/A", "—", "غير متاح"]) {
  assert.equal(priceCell(blank), null, `"${blank}" must read as no price`);
}
assert.equal(isNullToken("____"), true);
assert.equal(isNullToken("Not Available"), true);
assert.equal(isNullToken("0"), false, "a real zero is not the same as an empty cell");
assert.equal(priceCell(0), 0, "a published zero stays zero");

// `Hold` suspends the product. It is never a price of any kind.
assert.equal(isHoldToken("Hold"), true);
assert.equal(priceCell("Hold"), null);
assert.notEqual(priceCell("Hold"), 0);

// The workbook's own spellings, typos included.
assert.equal(normalizeDeliveryType("Record"), "recorded");
assert.equal(normalizeDeliveryType("Shiping"), "shipping");
assert.equal(normalizeDeliveryType("Certificat"), "certificate");
assert.equal(normalizeDeliveryType("Online"), "online");
assert.equal(normalizeDeliveryType("Offline"), "offline");
assert.equal(normalizeDeliveryType("Exam"), "exam");
assert.equal(normalizeDeliveryType("Renewal"), "renewal");
assert.equal(normalizeDeliveryType(""), "unknown");

// Excel hands numeric codes back as numbers; Odoo stores them as strings.
assert.equal(normalizeProductCode(586), "586");
assert.equal(normalizeProductCode("586.0"), "586");
assert.equal(normalizeProductCode(" 586 "), "586");

// A composite code names more than one product and is never split silently.
assert.equal(isCompositeCode("65 - 586"), true);
assert.equal(normalizeProductCode("65 - 586"), "65 - 586");
assert.equal(isCompositeCode("586"), false);

// An ambiguous slash date returns both readings rather than picking one.
const ambiguous = readAmbiguousDate("عرض اليوم الوطني ينتهي في 9/10/2026");
assert.ok(ambiguous, "the offer deadline must be recognised");
assert.equal(ambiguous.ambiguous, true);
assert.equal(ambiguous.dayFirst, "2026-10-09");
assert.equal(ambiguous.monthFirst, "2026-09-10");
// A date that can only be read one way is not ambiguous.
assert.equal(readAmbiguousDate("25/12/2026").ambiguous, false);

// Hand-written package cells.
assert.deepEqual(
  parsePricePhrases("1750 Taby /  1500 Cash").map((p) => [p.method, p.amount]),
  [
    ["tabby", 1750],
    ["cash", 1500],
  ],
);
assert.deepEqual(
  parsePricePhrases("999 Cash Only").map((p) => [p.method, p.amount]),
  [["cash", 999]],
);
// Free Arabic prose yields nothing to publish, which is the point.
assert.deepEqual(parsePricePhrases("أي دورة مسجلة منفردة بسعر 199 ريال للكاش فقط"), []);

/* --- the real workbook ----------------------------------------------------- */

const WORKBOOK = process.env.PRICE_WORKBOOK || "/Users/eyad/Downloads/New Price List.xlsx";

if (!existsSync(WORKBOOK)) {
  console.log(
    `price book parser: value assertions passed; workbook checks skipped (${WORKBOOK} not present)`,
  );
  process.exit(0);
}

const workbook = readXlsx(readFileSync(WORKBOOK));

// Eight sheets, in the order a person sees them in Excel.
assert.equal(workbook.sheets.length, 8, "the workbook has eight sheets");
for (const expected of [
  "Management",
  "Mech & Elec",
  "BIM all",
  "Architecture & Decor",
  "Civil Courses",
  "Others",
]) {
  assert.ok(workbook.sheetNames.includes(expected), `sheet "${expected}" must be read`);
}

// The two narrative sheets are not price grids and must not be parsed as one.
const narrative = workbook.sheets.filter((sheet) => detectLayout(sheet.rows) === null);
assert.equal(narrative.length, 2, "the offers and incentive sheets have no code column");

const parsed = parsePriceWorkbook(workbook.sheets);

// 148 course rows before any de-duplication. This is the number the business
// counts, and a parser change that quietly drops six of them would otherwise
// look like a successful import.
assert.equal(parsed.sourceRowCount, 148, "148 source price rows");

// Eleven codes repeat. Every occurrence is kept.
assert.equal(parsed.duplicateCodes.length, 11, "eleven duplicated product codes");
const duplicated = parsed.duplicateCodes.map((entry) => entry.code).sort();
assert.deepEqual(
  duplicated,
  ["102", "206", "36", "43", "59", "593", "595", "597", "693", "701", "709"].sort(),
);
for (const entry of parsed.duplicateCodes) {
  const kept = parsed.items.filter((item) => item.normalizedProductCode === entry.code);
  const rows = new Set(kept.map((item) => `${item.sourceSheet}:${item.sourceRow}`));
  assert.equal(
    rows.size,
    entry.count,
    `code ${entry.code} must keep all ${entry.count} of its rows, not collapse to one`,
  );
}

// Two of the duplicates publish different bands. That disagreement has to be
// surfaced, not averaged away.
const conflicting = parsed.duplicateCodes.filter((entry) => entry.conflicting).map((e) => e.code);
assert.deepEqual(conflicting.sort(), ["102", "59"], "codes 59 and 102 disagree on their band");

// A ceiling/floor sheet keeps both bounds.
const cfm = parsed.items.find(
  (item) => item.rawProductCode === "65 - 586" && item.paymentMethod === "tabby",
);
assert.ok(cfm, "the composite CFM row is imported");
assert.equal(cfm.maximumPrice, 3750);
assert.equal(cfm.minimumPrice, 2800);
assert.equal(cfm.currency, "SAR");
const cfmCash = parsed.items.find(
  (item) => item.rawProductCode === "65 - 586" && item.paymentMethod === "cash",
);
assert.equal(cfmCash.maximumPrice, 3500);
assert.equal(cfmCash.minimumPrice, 2500);

// A single-price sheet publishes one number, which is both list and floor.
const sewer = parsed.items.find(
  (item) => item.normalizedProductCode === "88" && item.paymentMethod === "tabby",
);
assert.equal(sewer.exactPrice, 400);
assert.equal(sewer.minimumPrice, 400);
assert.equal(sewer.maximumPrice, null);

// A package price is never filed as a course price.
const bimPackage = parsed.items.filter(
  (item) => item.sourceSheet === "BIM all" && item.pricingScope === "bundle",
);
assert.ok(bimPackage.length, "BIM package prices are imported");
for (const item of bimPackage) {
  assert.notEqual(item.pricingScope, "individual");
  assert.equal(item.requiresReview, true, "a package waits for its components to be linked");
}
const bimCourse = parsed.items.find(
  (item) =>
    item.normalizedProductCode === "592" &&
    item.paymentMethod === "tabby" &&
    item.pricingScope === "individual",
);
assert.equal(bimCourse.exactPrice, 750, "the course keeps its own price, not the package's 1600");

// Level packages are their own scope, separate from both.
assert.ok(
  parsed.items.some((item) => item.pricingScope === "level"),
  "level package prices are imported",
);

// Hold suspends every rule for the product, not only the column it was typed in.
const held = parsed.items.filter((item) => item.onHold);
assert.equal(held.length, 4, "the suspended course is suspended in all four bands");
for (const item of held) {
  assert.equal(item.courseName, "FMP Preparation Course");
  assert.equal(item.active, false, "a suspended product must not be sellable");
  assert.notEqual(item.exactPrice, 0, "Hold is not a price of zero");
}

// Free-text offers arrive unpublished. Nothing typed in prose becomes an
// approved price without a person.
const freeText = parsed.items.filter(
  (item) => item.pricingScope === "offer" && item.exactPrice === null,
);
assert.ok(freeText.length, "prose offers are imported so nothing is lost");
for (const item of freeText) {
  assert.equal(item.active, false);
  assert.equal(item.requiresReview, true);
}

// Structured offers whose deadline is ambiguous also stay unpublished.
const datedOffers = parsed.items.filter(
  (item) => item.pricingScope === "offer" && item.exactPrice !== null,
);
assert.ok(datedOffers.length, "numeric offers are read");
for (const item of datedOffers) {
  assert.equal(item.active, false, "an offer is not live until its deadline is decided");
  assert.equal(item.requiresReview, true);
}
assert.ok(
  parsed.offerWindows.some((window) => window.dayFirst !== window.monthFirst),
  "the ambiguous deadline is reported for a person to resolve",
);

// Resolving the reading is what makes them live.
const resolved = parsePriceWorkbook(workbook.sheets, { offerDateReading: "day_first" });
const liveOffers = resolved.items.filter(
  (item) => item.pricingScope === "offer" && item.exactPrice !== null,
);
assert.ok(liveOffers.length);
assert.ok(
  liveOffers.every((item) => item.active && item.validTo === "2026-10-09"),
  "once a reading is chosen the offers carry that date",
);

// The staff bonus sheet is a badge, never a selling price.
const incentives = parsed.items.filter((item) => item.pricingScope === "incentive");
assert.ok(incentives.length, "the incentive sheet is imported as badges");
for (const item of incentives) {
  assert.equal(item.active, false, "an incentive does not authorise a sale price");
  assert.equal(item.requiresReview, true);
  assert.equal(item.minimumPrice, null, "an incentive publishes no floor to judge against");
}

// Internal section titles are carried across, spelling corrected for display.
const sections = new Set(parsed.items.map((item) => item.subcategory));
for (const expected of [
  "BIM MEP",
  "BIM Structure",
  "BIM Architecture",
  "Civil Infrastructure",
  "Civil Structure Design",
  "Road Package",
  "Steel Package",
  "Architecture",
  "Mechanical",
  "Electrical",
  "Interior Design",
]) {
  assert.ok(sections.has(expected), `section "${expected}" must be extracted`);
}

// The Egyptian column is a second currency, not a second course.
const egp = parsed.items.filter((item) => item.currency === "EGP");
assert.ok(egp.length, "Egyptian prices are imported");
for (const item of egp) {
  assert.equal(item.country, "Egypt");
  assert.notEqual(item.exactPrice, null);
}
// "Not Available" in that column means no Egyptian price, never zero.
assert.ok(
  parsed.issues.some((issue) => issue.code === "local_price_absent"),
  "an absent Egyptian price is reported rather than stored as zero",
);
assert.ok(!egp.some((item) => item.exactPrice === 0), "no Egyptian price was invented as zero");

console.log(
  `price book parser: all assertions passed (${parsed.sourceRowCount} source rows, ${parsed.items.length} rules, ${parsed.duplicateCodes.length} duplicate codes)`,
);
