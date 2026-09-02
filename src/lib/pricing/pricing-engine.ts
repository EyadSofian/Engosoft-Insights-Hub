// Decides whether one paid invoice line respected the published price.
//
// The engine is pure: invoice lines in, verdicts out. That keeps the rules
// readable and lets the test script exercise every case without a database or
// an Odoo connection.
//
// Its governing bias is that a wrong accusation costs more than a missed one.
// Wherever the evidence runs out — no confirmed product, no readable payment
// instrument, several instruments in different bands — the answer is "needs
// review", never "breach". Only a price below a floor that was actually
// published, for the method the customer actually paid with, is a breach.
import { money, withinWindow } from "./pricing-normalize.ts";
import type {
  AuditableInvoiceLine,
  ComplianceSeverity,
  ComplianceStatus,
  InvoicePriceAudit,
  MatchType,
  PaymentMethod,
  PaymentRead,
  PriceRule,
  ProductMapping,
} from "./pricing-types.ts";

export interface EngineOptions {
  /** The book's prices include tax, so compare against the tax-inclusive total. */
  taxInclusive: boolean;
  /** Below-floor share that turns a warning into a critical finding. */
  criticalVarianceShare?: number;
  /** Product names that are never judged: bonuses, gifts, free trials. */
  excludedProductPatterns?: RegExp[];
}

const DEFAULT_CRITICAL_SHARE = 0.15;

const DEFAULT_EXCLUDED: RegExp[] = [
  /\bbonus\b/i,
  /\bfree\b/i,
  /\bgift\b/i,
  /\bcomplimentary\b/i,
  /مجان/,
  /هدية/,
  /بونص/,
];

/* --- rule index ------------------------------------------------------------ */

export interface RuleIndex {
  byOdooProductId: Map<number, PriceRule[]>;
  byCode: Map<string, PriceRule[]>;
  /** Odoo product id to price-item ids, approved by a person. */
  manual: Map<number, { ids: Set<string>; matchType: "manual" | "alias" }>;
  byId: Map<string, PriceRule>;
}

/**
 * Build the lookup the matcher walks.
 *
 * Approved mappings are kept apart from the code index on purpose: the order a
 * match is found in is part of the verdict, and an operator needs to be able to
 * see that a line matched because someone approved it rather than because a
 * string happened to line up.
 */
export function buildRuleIndex(rules: PriceRule[], mappings: ProductMapping[] = []): RuleIndex {
  const byOdooProductId = new Map<number, PriceRule[]>();
  const byCode = new Map<string, PriceRule[]>();
  const byId = new Map<string, PriceRule>();
  const manual = new Map<number, { ids: Set<string>; matchType: "manual" | "alias" }>();

  for (const rule of rules) {
    byId.set(rule.id, rule);
    if (rule.odooProductId) {
      byOdooProductId.set(rule.odooProductId, [
        ...(byOdooProductId.get(rule.odooProductId) ?? []),
        rule,
      ]);
    }
    if (rule.normalizedProductCode) {
      byCode.set(rule.normalizedProductCode, [
        ...(byCode.get(rule.normalizedProductCode) ?? []),
        rule,
      ]);
    }
  }

  for (const mapping of mappings) {
    if (mapping.matchType !== "manual" && mapping.matchType !== "alias") continue;
    if (!mapping.approvedBy) continue;
    const entry = manual.get(mapping.odooProductId) ?? {
      ids: new Set<string>(),
      // A hand-made mapping outranks an alias when both exist.
      matchType: mapping.matchType,
    };
    entry.ids.add(mapping.priceItemId);
    if (mapping.matchType === "manual") entry.matchType = "manual";
    manual.set(mapping.odooProductId, entry);
  }

  return { byOdooProductId, byCode, manual, byId };
}

export interface MatchResult {
  rules: PriceRule[];
  matchType: MatchType;
}

/**
 * Find the rules that price this line, in the order the specification fixes.
 *
 * Name similarity is deliberately absent. Two courses called "Navisworks" can
 * be a 500 SAR online event and a 385 SAR recording, and a fuzzy match between
 * them would accuse a seller who did nothing wrong.
 */
export function matchRules(index: RuleIndex, line: AuditableInvoiceLine): MatchResult {
  if (line.odooProductId) {
    const direct = index.byOdooProductId.get(line.odooProductId);
    if (direct?.length) return { rules: direct, matchType: "odoo_product_id" };
  }

  const code = line.productCode.trim().toUpperCase();
  if (code) {
    const byCode = index.byCode.get(code);
    if (byCode?.length) return { rules: byCode, matchType: "exact_code" };
  }

  if (line.odooProductId) {
    const approved = index.manual.get(line.odooProductId);
    if (approved?.ids.size) {
      const rules = [...approved.ids]
        .map((id) => index.byId.get(id))
        .filter((rule): rule is PriceRule => !!rule);
      if (rules.length) return { rules, matchType: approved.matchType };
    }
  }

  return { rules: [], matchType: "none" };
}

/* --- discount allocation --------------------------------------------------- */

/** A line that is a charge in its own right, never a discount to spread. */
const isAncillary = (line: AuditableInvoiceLine): boolean =>
  /shipping|shiping|certificat|شحن|شهاد/i.test(`${line.productName} ${line.productCode}`);

/**
 * Spread invoice-level discount lines across the product lines they discount.
 *
 * Odoo lets a seller add one negative line for a whole-invoice discount. Judging
 * the product lines without it reads the sale as full price; judging the whole
 * invoice hides which course was actually discounted. Allocating by each line's
 * share of value is the only split that reconstructs the per-course price.
 *
 * Shipping and certificate lines are left out of the split in both directions:
 * a negative one is a return of that item, not a discount, and a positive one is
 * a separate charge that should not absorb somebody else's discount.
 */
export function allocateInvoiceDiscounts(
  lines: AuditableInvoiceLine[],
  taxInclusive: boolean,
): AuditableInvoiceLine[] {
  const basis = (line: AuditableInvoiceLine): number =>
    taxInclusive ? line.totalInCurrency : line.untaxedTotal;

  const positives = lines.filter((line) => basis(line) > 0 && !isAncillary(line));
  const discountTotal = lines
    .filter((line) => basis(line) < 0 && !isAncillary(line) && !line.isCreditNote)
    .reduce((sum, line) => sum + basis(line), 0);

  if (discountTotal >= 0 || !positives.length) {
    return lines.map((line) => ({ ...line, allocatedDiscount: 0 }));
  }

  const positiveTotal = positives.reduce((sum, line) => sum + basis(line), 0);
  if (positiveTotal <= 0) return lines.map((line) => ({ ...line, allocatedDiscount: 0 }));

  const share = new Map<string, number>();
  for (const line of positives) {
    share.set(line.invoiceLineId, money((basis(line) / positiveTotal) * Math.abs(discountTotal)));
  }
  return lines.map((line) => ({
    ...line,
    allocatedDiscount: share.get(line.invoiceLineId) ?? 0,
  }));
}

/* --- price basis ----------------------------------------------------------- */

/**
 * What one unit was actually sold for, in the invoice's own currency.
 *
 * Never derived from the recognised USD figure: the price book quotes SAR and
 * EGP, and converting a Riyal sale through today's rate to compare against a
 * Riyal floor would invent a variance out of the exchange rate.
 */
export function actualUnitPrice(line: AuditableInvoiceLine, taxInclusive: boolean): number | null {
  const quantity = line.quantity;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const gross = taxInclusive ? line.totalInCurrency : line.untaxedTotal;
  return money((gross - (line.allocatedDiscount ?? 0)) / quantity);
}

/**
 * The date that decides which price was in force.
 *
 * The order date first, because that is when the price was agreed. Payment date
 * is never used: an invoice paid in October was still sold at September's
 * published price, and judging it against October's book would manufacture
 * breaches every time a price rises.
 */
export function priceBookDate(line: AuditableInvoiceLine): string {
  return line.saleDate || line.invoiceDate || "";
}

/* --- judgement ------------------------------------------------------------- */

const scopeRank: Record<PriceRule["pricingScope"], number> = {
  individual: 0,
  level: 1,
  bundle: 2,
  offer: 3,
  incentive: 4,
};

interface Band {
  minimum: number | null;
  maximum: number | null;
  ruleIds: string[];
  onHold: boolean;
  requiresReview: boolean;
}

/**
 * Collapse several matching rules into one allowed band.
 *
 * Eleven product codes appear more than once in the workbook, and two of those
 * copies disagree about the floor. Taking the lowest published floor and the
 * highest published ceiling means a seller is judged against the most generous
 * thing the company actually published — a disagreement in the price list
 * becomes the company's problem, not the seller's.
 */
export function widestBand(rules: PriceRule[]): Band {
  const band: Band = {
    minimum: null,
    maximum: null,
    ruleIds: [],
    onHold: false,
    requiresReview: false,
  };
  for (const rule of rules) {
    band.ruleIds.push(rule.id);
    if (rule.onHold) band.onHold = true;
    if (rule.requiresReview) band.requiresReview = true;

    const floor = rule.minimumPrice ?? rule.exactPrice;
    if (floor !== null && (band.minimum === null || floor < band.minimum)) band.minimum = floor;

    const ceiling = rule.maximumPrice ?? rule.exactPrice;
    if (ceiling !== null && (band.maximum === null || ceiling > band.maximum)) {
      band.maximum = ceiling;
    }
  }
  return band;
}

/** Rules that price this method: an exact match, or a method-agnostic rule. */
function rulesForMethod(rules: PriceRule[], method: PaymentMethod): PriceRule[] {
  const exact = rules.filter((rule) => rule.paymentMethod === method);
  if (exact.length) return exact;
  return rules.filter((rule) => rule.paymentMethod === "any");
}

/** Highest-precedence scope present: a course price beats a package price. */
function preferredScope(rules: PriceRule[]): PriceRule[] {
  const priced = rules.filter(
    (rule) => rule.pricingScope !== "offer" && rule.pricingScope !== "incentive",
  );
  if (!priced.length) return [];
  const best = Math.min(...priced.map((rule) => scopeRank[rule.pricingScope]));
  return priced.filter((rule) => scopeRank[rule.pricingScope] === best);
}

export interface Judgement {
  status: ComplianceStatus;
  severity: ComplianceSeverity;
  reason: string;
  allowedMinimum: number | null;
  allowedMaximum: number | null;
  priceItemId: string;
  matchType: MatchType;
  varianceAmount: number;
  variancePercent: number | null;
  leakageAmount: number;
  actualUnitPrice: number;
}

const severityFor = (
  status: ComplianceStatus,
  variancePercent: number | null,
  criticalShare: number,
): ComplianceSeverity => {
  if (status === "below_minimum") {
    return (variancePercent ?? 0) >= criticalShare ? "critical" : "warning";
  }
  if (
    status === "unmatched_product" ||
    status === "unknown_payment_method" ||
    status === "mixed_payment_review" ||
    status === "expired_offer"
  ) {
    return "needs_review";
  }
  if (status === "above_list") return "informational";
  return "none";
};

const empty = (
  status: ComplianceStatus,
  reason: string,
  matchType: MatchType,
  actual: number,
  severity: ComplianceSeverity = "needs_review",
): Judgement => ({
  status,
  severity,
  reason,
  allowedMinimum: null,
  allowedMaximum: null,
  priceItemId: "",
  matchType,
  varianceAmount: 0,
  variancePercent: null,
  leakageAmount: 0,
  actualUnitPrice: actual,
});

/**
 * Judge one invoice line.
 *
 * `payment` must come from the settled payment record. Nothing here infers an
 * instrument from the currency, the country or the amount, and a payment term
 * is not an instrument: an unreadable payment comes back as
 * `unknown_payment_method` so somebody can go and look.
 */
export function judgeLine(
  line: AuditableInvoiceLine,
  payment: PaymentRead,
  index: RuleIndex,
  options: EngineOptions,
): Judgement {
  const criticalShare = options.criticalVarianceShare ?? DEFAULT_CRITICAL_SHARE;
  const excluded = options.excludedProductPatterns ?? DEFAULT_EXCLUDED;
  const price = actualUnitPrice(line, options.taxInclusive);

  if (line.isCreditNote) {
    return empty(
      "excluded",
      "Credit note. Shown as a return, not judged as a sale.",
      "none",
      price ?? 0,
      "none",
    );
  }
  if (price === null) {
    return empty("excluded", "Line has no positive quantity to price.", "none", 0, "none");
  }
  if (price <= 0) {
    return empty(
      "excluded",
      "Line was invoiced at zero or less. A giveaway is not a discount breach; check why it is free.",
      "none",
      price,
      "none",
    );
  }
  if (excluded.some((pattern) => pattern.test(`${line.productName} ${line.productCode}`))) {
    return empty(
      "excluded",
      "Product is marked as a bonus or free item and is not judged on price.",
      "none",
      price,
      "none",
    );
  }

  // A package component has its own commercial price on the Odoo sale order.
  // Comparing it with the standalone course floor is a category error: a
  // 250-SAR component inside a 2,500-SAR package is not a 350-SAR discount on a
  // 600-SAR standalone course. Odoo is authoritative here because it preserves
  // both the selected pricelist and the sale line that produced the invoice.
  if (line.pricingContext === "package") {
    const packagePrice = line.odooExpectedUnitPrice;
    const packageActual = actualUnitPrice(line, false);
    if (packageActual === null || packagePrice === null || packagePrice <= 0) {
      return empty(
        "package_price_unresolved",
        `Odoo identifies this as a package component${line.pricingContextName ? ` (${line.pricingContextName})` : ""}, but its agreed component price could not be read safely. It is not treated as a breach.`,
        "odoo_pricelist",
        packageActual ?? price,
        "none",
      );
    }

    const tolerance = 0.01;
    const varianceAmount = money(packagePrice - packageActual);
    const variancePercent = packagePrice > 0 ? varianceAmount / packagePrice : null;
    const source = line.odooPricelistName || line.pricingContextName || "Odoo package pricelist";

    if (packageActual > packagePrice + tolerance) {
      return {
        status: "above_list",
        severity: "informational",
        reason: `Package component sold at ${packageActual} ${line.currency}, above its Odoo-agreed ${packagePrice} price from ${source}. Not a loss; shown for information.`,
        allowedMinimum: packagePrice,
        allowedMaximum: packagePrice,
        priceItemId: "",
        matchType: "odoo_pricelist",
        varianceAmount,
        variancePercent,
        leakageAmount: 0,
        actualUnitPrice: packageActual,
      };
    }

    if (packageActual + tolerance >= packagePrice) {
      return {
        status: "compliant_package",
        severity: "none",
        reason: `Package component sold at its Odoo-agreed price of ${packagePrice} ${line.currency} from ${source}; the standalone course price does not apply.`,
        allowedMinimum: packagePrice,
        allowedMaximum: packagePrice,
        priceItemId: "",
        matchType: "odoo_pricelist",
        varianceAmount: 0,
        variancePercent: 0,
        leakageAmount: 0,
        actualUnitPrice: packageActual,
      };
    }

    return {
      status: "below_minimum",
      severity: severityFor("below_minimum", variancePercent, criticalShare),
      reason: `Package component sold at ${packageActual} ${line.currency}, below its Odoo-agreed ${packagePrice} price from ${source}. Short by ${varianceAmount} per unit.`,
      allowedMinimum: packagePrice,
      allowedMaximum: packagePrice,
      priceItemId: "",
      matchType: "odoo_pricelist",
      varianceAmount,
      variancePercent,
      leakageAmount: money(varianceAmount * line.quantity),
      actualUnitPrice: packageActual,
    };
  }

  const matched = matchRules(index, line);
  if (!matched.rules.length) {
    return empty(
      "unmatched_product",
      `No confirmed price rule for product code "${line.productCode || "(none)"}". Link it before judging this sale.`,
      "none",
      price,
    );
  }

  const on = priceBookDate(line);
  // Currency first, then dates. An offer that has closed still has to reach the
  // offer branch below — dropping it here would report a price that plainly
  // matches a promotion as a plain discount breach, with no explanation.
  const sameCurrency = matched.rules.filter((rule) => rule.currency === line.currency);
  const live = sameCurrency.filter(
    (rule) => rule.active && withinWindow(on || "9999-12-31", rule.validFrom, rule.validTo),
  );
  if (!sameCurrency.length) {
    const currencies = [...new Set(matched.rules.map((rule) => rule.currency))].join(", ");
    return empty(
      "unmatched_product",
      `Prices are published in ${currencies || "no currency"} but the invoice is in ${line.currency}. A sale is compared in its own currency only.`,
      matched.matchType,
      price,
    );
  }

  if (payment.method === "unknown") {
    return empty(
      "unknown_payment_method",
      "The settled payment does not name an instrument, and the price band depends on it.",
      matched.matchType,
      price,
    );
  }

  const offerRules = sameCurrency.filter((rule) => rule.pricingScope === "offer");
  const judgeAgainst = (method: PaymentMethod): { band: Band; rules: PriceRule[] } => {
    const forMethod = rulesForMethod(live, method);
    const scoped = preferredScope(forMethod);
    return { band: widestBand(scoped), rules: scoped };
  };

  let method = payment.method;
  if (method === "mixed") {
    // Several instruments only settle into one verdict when they all price the
    // same. Otherwise there is no single rule to judge against, and picking one
    // would be a coin toss dressed up as a finding.
    const distinct = [...new Set(payment.methods.filter((value) => value !== "unknown"))];
    const bands = distinct.map((value) => judgeAgainst(value).band);
    const signatures = new Set(bands.map((band) => `${band.minimum}:${band.maximum}`));
    if (signatures.size !== 1 || !distinct.length) {
      return empty(
        "mixed_payment_review",
        `Settled with ${distinct.join(" + ") || "several instruments"}, which do not share one published band.`,
        matched.matchType,
        price,
      );
    }
    method = distinct[0];
  }

  const { band, rules: applied } = judgeAgainst(method);
  if (!applied.length || band.minimum === null) {
    return empty(
      "unmatched_product",
      `No published price for ${method} on this product. It is not a breach; publish the band or map the product.`,
      matched.matchType,
      price,
    );
  }

  const holdNote = band.onHold
    ? " This product is marked on hold and should not have been sold at all."
    : "";
  const reviewNote = band.requiresReview
    ? " The matching price rule is flagged for review, so treat this verdict as provisional."
    : "";
  const priceItemId = applied[0]?.id ?? "";
  // Bound outside the closure: the guard above already established it is set.
  const floor = band.minimum;
  const varianceAmount = money(floor - price);
  const variancePercent = floor > 0 ? varianceAmount / floor : null;

  const decide = (): Omit<Judgement, "severity"> => {
    if (band.maximum !== null && price > band.maximum) {
      return {
        status: "above_list",
        reason: `Sold at ${price} ${line.currency}, above the published ${band.maximum}. Not a loss; shown for information.${holdNote}${reviewNote}`,
        allowedMinimum: floor,
        allowedMaximum: band.maximum,
        priceItemId,
        matchType: matched.matchType,
        varianceAmount,
        variancePercent,
        leakageAmount: 0,
        actualUnitPrice: price,
      };
    }
    if (price >= floor) {
      return {
        status: "compliant",
        reason: `Sold at ${price} ${line.currency}, inside the published ${floor}${band.maximum !== null && band.maximum !== floor ? `-${band.maximum}` : ""} band for ${method}.${holdNote}${reviewNote}`,
        allowedMinimum: floor,
        allowedMaximum: band.maximum,
        priceItemId,
        matchType: matched.matchType,
        varianceAmount,
        variancePercent,
        leakageAmount: 0,
        actualUnitPrice: price,
      };
    }

    // Older invoices can lack the sale-line link even though the published book
    // confirms this product participates in packages. Do not accuse the seller
    // using the standalone floor until Odoo resolves which context was sold.
    const packageCouldApply = sameCurrency.some(
      (rule) => rule.pricingScope === "bundle" || rule.pricingScope === "level",
    );
    if (line.pricingContext === "unknown" && packageCouldApply) {
      return {
        status: "package_price_unresolved",
        reason:
          "This course also belongs to a package, but Odoo did not provide the linked sale-line price. The standalone floor is therefore not used to call it a breach.",
        allowedMinimum: null,
        allowedMaximum: null,
        priceItemId: "",
        matchType: matched.matchType,
        varianceAmount: 0,
        variancePercent: null,
        leakageAmount: 0,
        actualUnitPrice: price,
      };
    }

    // Below the floor. An offer is the one thing that can explain it.
    const methodOffers = rulesForMethod(offerRules, method);
    const live = methodOffers.filter(
      (rule) => rule.active && withinWindow(on || "9999-12-31", rule.validFrom, rule.validTo),
    );
    const covering = live.filter(
      (rule) => (rule.minimumPrice ?? rule.exactPrice ?? Infinity) <= price,
    );
    if (covering.length) {
      const offerFloor = Math.min(
        ...covering.map((rule) => rule.minimumPrice ?? rule.exactPrice ?? Infinity),
      );
      return {
        status: "compliant_offer",
        reason: `Sold at ${price} ${line.currency}, below the ${floor} list floor but at or above the published offer floor of ${offerFloor} for ${method}.${holdNote}`,
        allowedMinimum: offerFloor,
        allowedMaximum: band.maximum,
        priceItemId: covering[0].id,
        matchType: matched.matchType,
        varianceAmount: money(offerFloor - price),
        variancePercent: offerFloor > 0 ? money(offerFloor - price) / offerFloor : null,
        leakageAmount: 0,
        actualUnitPrice: price,
      };
    }

    const expired = methodOffers.filter(
      (rule) =>
        rule.active &&
        (rule.minimumPrice ?? rule.exactPrice ?? Infinity) <= price &&
        !withinWindow(on || "9999-12-31", rule.validFrom, rule.validTo),
    );
    if (expired.length) {
      const offer = expired[0];
      return {
        status: "expired_offer",
        reason: `Price matches an offer priced at ${offer.minimumPrice ?? offer.exactPrice}, but the sale on ${on || "an unknown date"} falls outside its ${offer.validFrom || "open"} to ${offer.validTo || "open"} window.`,
        allowedMinimum: floor,
        allowedMaximum: band.maximum,
        priceItemId: offer.id,
        matchType: matched.matchType,
        varianceAmount,
        variancePercent,
        leakageAmount: 0,
        actualUnitPrice: price,
      };
    }

    return {
      status: "below_minimum",
      reason: `Sold at ${price} ${line.currency} against a published ${method} floor of ${floor}. Short by ${varianceAmount} per unit.${holdNote}${reviewNote}`,
      allowedMinimum: floor,
      allowedMaximum: band.maximum,
      priceItemId,
      matchType: matched.matchType,
      varianceAmount,
      variancePercent,
      leakageAmount: money(varianceAmount * line.quantity),
      actualUnitPrice: price,
    };
  };

  const decided = decide();
  return {
    ...decided,
    severity: severityFor(decided.status, decided.variancePercent, criticalShare),
  };
}

/** Assemble the stored audit row for one line. */
export function auditLine(
  line: AuditableInvoiceLine,
  payment: PaymentRead,
  index: RuleIndex,
  options: EngineOptions,
  book: { id: string; version: number },
  auditedAt = new Date().toISOString(),
): InvoicePriceAudit {
  const judgement = judgeLine(line, payment, index, options);
  return {
    invoiceLineId: line.invoiceLineId,
    invoiceNumber: line.invoiceNumber,
    priceBookId: book.id,
    priceBookVersion: book.version,
    priceItemId: judgement.priceItemId,
    paymentMethod: payment.method,
    paymentMethodRaw: payment.raw.join(" | "),
    currency: line.currency,
    quantity: line.quantity,
    actualUnitPrice: judgement.actualUnitPrice,
    allowedMinimum: judgement.allowedMinimum,
    allowedMaximum: judgement.allowedMaximum,
    complianceStatus: judgement.status,
    severity: judgement.severity,
    varianceAmount: judgement.varianceAmount,
    variancePercent: judgement.variancePercent,
    leakageAmount: judgement.leakageAmount,
    matchType: judgement.matchType,
    reason: judgement.reason,
    auditedAt,
    saleDate: line.saleDate,
    invoiceDate: line.invoiceDate,
    paymentDate: line.paymentDate,
    salesperson: line.salesperson,
    salesTeam: line.salesTeam,
    company: line.company,
    productCode: line.productCode,
    productName: line.productName,
    priceSource: line.pricingContext === "package" ? "odoo_package" : "price_book",
    pricingContext: line.pricingContext,
    pricingContextName: line.pricingContextName,
    odooSaleOrderName: line.odooSaleOrderName,
    odooPricelistId: line.odooPricelistId,
    odooPricelistName: line.odooPricelistName,
    odooPricelistItemId: line.odooPricelistItemId,
    odooPricelistItemName: line.odooPricelistItemName,
  };
}

/* --- roll-up --------------------------------------------------------------- */

export interface ComplianceTotals {
  auditedLines: number;
  /** Lines eligible for a verdict: everything except excluded ones. */
  eligibleLines: number;
  matchedLines: number;
  coverage: number | null;
  judgedLines: number;
  compliantLines: number;
  complianceRate: number | null;
  belowMinimumLines: number;
  belowMinimumValue: number;
  unmatchedLines: number;
  unknownPaymentLines: number;
  needsReviewLines: number;
  aboveListLines: number;
  packageLines: number;
  unresolvedPackageLines: number;
  excludedLines: number;
  byStatus: Record<string, number>;
  byCurrencyLeakage: Record<string, number>;
}

/**
 * Roll audits up for the KPI cards.
 *
 * Coverage and compliance are reported over eligible lines only. Counting
 * credit notes and bonus lines in the denominator would make the rate move
 * whenever the refund volume moved, which says nothing about pricing discipline.
 */
export function summarize(audits: InvoicePriceAudit[]): ComplianceTotals {
  const byStatus: Record<string, number> = {};
  const byCurrencyLeakage: Record<string, number> = {};
  let eligible = 0;
  let matched = 0;
  let judged = 0;
  let compliant = 0;
  let belowMinimum = 0;
  let belowMinimumValue = 0;
  let unmatched = 0;
  let unknownPayment = 0;
  let needsReview = 0;
  let aboveList = 0;
  let packageLines = 0;
  let unresolvedPackageLines = 0;
  let excludedLines = 0;

  for (const audit of audits) {
    byStatus[audit.complianceStatus] = (byStatus[audit.complianceStatus] ?? 0) + 1;
    if (audit.complianceStatus === "excluded") {
      excludedLines++;
      continue;
    }
    if (audit.complianceStatus === "package_price_unresolved") {
      unresolvedPackageLines++;
      continue;
    }
    eligible++;
    if (audit.complianceStatus !== "unmatched_product") matched++;
    if (
      audit.complianceStatus === "compliant" ||
      audit.complianceStatus === "compliant_package" ||
      audit.complianceStatus === "compliant_offer" ||
      audit.complianceStatus === "above_list" ||
      audit.complianceStatus === "below_minimum"
    ) {
      judged++;
    }
    if (
      audit.complianceStatus === "compliant" ||
      audit.complianceStatus === "compliant_package" ||
      audit.complianceStatus === "compliant_offer" ||
      audit.complianceStatus === "above_list"
    ) {
      compliant++;
    }
    if (audit.pricingContext === "package") packageLines++;
    if (audit.complianceStatus === "above_list") aboveList++;
    if (audit.complianceStatus === "below_minimum") {
      belowMinimum++;
      belowMinimumValue += audit.leakageAmount;
      byCurrencyLeakage[audit.currency] =
        (byCurrencyLeakage[audit.currency] ?? 0) + audit.leakageAmount;
    }
    if (audit.complianceStatus === "unmatched_product") unmatched++;
    if (audit.complianceStatus === "unknown_payment_method") unknownPayment++;
    if (audit.severity === "needs_review") needsReview++;
  }

  return {
    auditedLines: audits.length,
    eligibleLines: eligible,
    matchedLines: matched,
    coverage: eligible > 0 ? matched / eligible : null,
    judgedLines: judged,
    compliantLines: compliant,
    complianceRate: judged > 0 ? compliant / judged : null,
    belowMinimumLines: belowMinimum,
    belowMinimumValue: money(belowMinimumValue),
    unmatchedLines: unmatched,
    unknownPaymentLines: unknownPayment,
    needsReviewLines: needsReview,
    aboveListLines: aboveList,
    packageLines,
    unresolvedPackageLines,
    excludedLines,
    byStatus,
    byCurrencyLeakage: Object.fromEntries(
      Object.entries(byCurrencyLeakage).map(([currency, value]) => [currency, money(value)]),
    ),
  };
}
