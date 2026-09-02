// Invoice-level offers whose price covers several Odoo products.
//
// Odoo posts one invoice line per course even when the customer bought one
// announced offer. The standalone course floor must not be repeated on those
// component lines. A bundle is applied only when all three sources agree:
//
//   * the published price-book item names the exact component product codes;
//   * the Odoo lines belong to the same sale order and carry the same discount;
//   * the settled payment method and currency match the published offer.
//
// If any of that evidence is missing, the function leaves the invoice alone.
import { money, withinWindow } from "./pricing-normalize.ts";
import type {
  AuditableInvoiceLine,
  PaymentRead,
  PriceBookItem,
  PriceMethodScope,
} from "./pricing-types.ts";

const componentCodes = (item: PriceBookItem): string[] =>
  String(item.rawSourceData.bundle_component_codes ?? "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

const methodMatches = (scope: PriceMethodScope, payment: PaymentRead): boolean =>
  scope === "any" || scope === payment.method;

const isAncillary = (line: AuditableInvoiceLine): boolean =>
  /shipping|shiping|certificat|شحن|شهاد/i.test(`${line.productName} ${line.productCode}`);

const lineBasis = (line: AuditableInvoiceLine, taxInclusive: boolean): number =>
  (taxInclusive ? line.totalInCurrency : line.untaxedTotal) - (line.allocatedDiscount ?? 0);

const expectedExTaxUnit = (
  expectedOnBookBasis: number,
  line: AuditableInvoiceLine,
  taxInclusive: boolean,
): number | null => {
  if (!(line.quantity > 0)) return null;
  const taxFactor =
    line.untaxedTotal > 0 && line.totalInCurrency > 0
      ? line.totalInCurrency / line.untaxedTotal
      : 1;
  const safeTaxFactor = taxFactor > 0.5 && taxFactor < 1.5 ? taxFactor : 1;
  const unit = expectedOnBookBasis / line.quantity / (taxInclusive ? safeTaxFactor : 1);
  return Number.isFinite(unit) && unit > 0 ? Math.round(unit * 10_000) / 10_000 : null;
};

const sameDiscount = (lines: AuditableInvoiceLine[]): boolean => {
  const values = lines
    .map((line) => line.odooDiscountPercent)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length !== lines.length || !values.length) return false;
  return Math.max(...values) - Math.min(...values) <= 0.02;
};

/**
 * Replace per-course pricing with one published bundled-offer allocation.
 *
 * A passing bundle uses the posted Odoo allocation as each component's allowed
 * allocation, because the business rule is on the invoice total. If a bundle
 * is genuinely under its published total, the entire gap is attached to the
 * primary component so one order creates one finding rather than three.
 */
export function applyPublishedBundleOffer(
  input: AuditableInvoiceLine[],
  payment: PaymentRead,
  items: PriceBookItem[],
  taxInclusive: boolean,
): AuditableInvoiceLine[] {
  if (input.length < 2 || payment.method === "unknown" || payment.method === "mixed") return input;
  if (input.some((line) => line.pricingContext === "package")) return input;

  const lines = input.filter(
    (line) => !line.isCreditNote && lineBasis(line, taxInclusive) > 0 && !isAncillary(line),
  );
  if (lines.length < 2) return input;

  const saleOrders = new Set(lines.map((line) => line.odooSaleOrderName).filter(Boolean));
  if (
    saleOrders.size !== 1 ||
    lines.some((line) => !line.odooPricingChecked || !line.odooSaleOrderLineId) ||
    !sameDiscount(lines)
  ) {
    return input;
  }

  const actualCodes = lines.map((line) => line.productCode.trim().toUpperCase()).filter(Boolean);
  if (actualCodes.length !== lines.length) return input;
  const actualSet = new Set(actualCodes);
  const on = lines[0].saleDate || lines[0].invoiceDate || "";
  const currency = lines[0].currency;

  const candidates = items
    .filter((item) => {
      const codes = componentCodes(item);
      return (
        item.pricingScope === "offer" &&
        item.active &&
        !item.requiresReview &&
        item.currency === currency &&
        methodMatches(item.paymentMethod, payment) &&
        (item.minimumPrice ?? item.exactPrice) !== null &&
        codes.length === actualSet.size &&
        codes.every((code) => actualSet.has(code)) &&
        withinWindow(on || "9999-12-31", item.validFrom, item.validTo)
      );
    })
    .sort((a, b) => componentCodes(b).length - componentCodes(a).length);
  const offer = candidates[0];
  if (!offer) return input;

  const codes = componentCodes(offer);
  const primaryCode = String(offer.rawSourceData.bundle_primary_code ?? codes[0] ?? "")
    .trim()
    .toUpperCase();
  const quantityByCode = new Map(
    lines.map((line) => [line.productCode.trim().toUpperCase(), line.quantity]),
  );
  const bundleQuantity =
    quantityByCode.get(primaryCode) ?? Math.min(...lines.map((line) => line.quantity));
  if (!(bundleQuantity > 0) || codes.some((code) => quantityByCode.get(code) !== bundleQuantity)) {
    return input;
  }

  const publishedUnit = offer.minimumPrice ?? offer.exactPrice;
  if (publishedUnit === null || !(publishedUnit > 0)) return input;
  const publishedTotal = money(publishedUnit * bundleQuantity);
  const actualTotal = money(lines.reduce((sum, line) => sum + lineBasis(line, taxInclusive), 0));
  const gap = money(Math.max(0, publishedTotal - actualTotal));
  const anchor =
    lines.find((line) => line.productCode.trim().toUpperCase() === primaryCode) ?? lines[0];
  const title = offer.bundleName || offer.courseName || "Published bundle";
  const contextName = `${title} · ${actualTotal} / ${publishedTotal} ${currency} · ${offer.sourceSheet}:${offer.sourceRow}`;
  const matchedIds = new Set(lines.map((line) => line.invoiceLineId));

  return input.map((line) => {
    if (!matchedIds.has(line.invoiceLineId)) return line;
    const actual = lineBasis(line, taxInclusive);
    const expected = actual + (gap > 0 && line.invoiceLineId === anchor.invoiceLineId ? gap : 0);
    return {
      ...line,
      pricingContext: "offer_bundle",
      pricingContextName: contextName,
      pricingContextItemId: offer.id,
      odooExpectedUnitPrice: expectedExTaxUnit(expected, line, taxInclusive),
    };
  });
}
