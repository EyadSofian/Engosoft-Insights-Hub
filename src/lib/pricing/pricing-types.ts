// Shared vocabulary for the Price Book and sales price compliance feature.
//
// Everything here is isomorphic on purpose: the parser, the pricing engine and
// the React pages all agree on one set of names, and the Node test scripts can
// import it without pulling in `pg` or the Odoo client.

/** How a course is delivered. Raw workbook spellings are normalized onto this. */
export type DeliveryType =
  "online" | "recorded" | "offline" | "exam" | "shipping" | "certificate" | "renewal" | "unknown";

/**
 * A real payment instrument.
 *
 * `any` exists only on a price rule that was published without a method split
 * (the workbook's Egyptian column). It is never the verdict of a payment read:
 * an invoice whose method could not be established is `unknown`, and one paid
 * through several instruments is `mixed`.
 */
export type PaymentMethod =
  "tabby" | "tamara" | "cash" | "cashier" | "bank_transfer" | "mixed" | "unknown";

export type PriceMethodScope = PaymentMethod | "any";

/**
 * What a price row prices.
 *
 * `bundle` and `level` are deliberately separate from `individual`: a package
 * price is not a course price, and treating one as the other is the fastest way
 * to invent a violation. `incentive` is the staff bonus sheet, which is shown as
 * a badge and never used to judge a sale unless an admin republishes it.
 */
export type PricingScope = "individual" | "bundle" | "level" | "offer" | "incentive";

/** The commercial context Odoo says the invoice line was sold in. */
export type PricingContext = "individual" | "package" | "unknown";

/** The authority used for the final per-line comparison. */
export type AuditPriceSource = "price_book" | "odoo_package";

export type PriceBookStatus = "draft" | "published" | "archived";

export type PriceSourceType = "xlsx" | "google_sheet" | "manual";

export type ComplianceStatus =
  /** Inside the published band for the invoice's own payment method. */
  | "compliant"
  /** Inside the component price Odoo recorded for a package sale. */
  | "compliant_package"
  /** Below list, but matches a published offer that was live on the sale date. */
  | "compliant_offer"
  /** Below the published floor. The only status that counts as a breach. */
  | "below_minimum"
  /** Above list. Not a loss; shown for information. */
  | "above_list"
  /** No confirmed product match. Never a breach, never a pass. */
  | "unmatched_product"
  /** The payment instrument could not be established from the payment record. */
  | "unknown_payment_method"
  /** Several instruments that do not share one price band. */
  | "mixed_payment_review"
  /** Matches an offer, but the sale happened outside the offer window. */
  | "expired_offer"
  /** Odoo confirms a package sale but its component price cannot be read safely. */
  | "package_price_unresolved"
  /** Credit note, bonus line, or otherwise not a sale to judge. */
  | "excluded";

export type ComplianceSeverity = "critical" | "warning" | "needs_review" | "informational" | "none";

/** Statuses that mean "we could not decide", as opposed to a pass or a breach. */
export const REVIEW_STATUSES: ReadonlySet<ComplianceStatus> = new Set<ComplianceStatus>([
  "unmatched_product",
  "unknown_payment_method",
  "mixed_payment_review",
  "expired_offer",
]);

export const PASS_STATUSES: ReadonlySet<ComplianceStatus> = new Set<ComplianceStatus>([
  "compliant",
  "compliant_package",
  "compliant_offer",
  "above_list",
]);

export interface PriceBook {
  id: string;
  name: string;
  version: number;
  status: PriceBookStatus;
  effectiveFrom: string;
  effectiveTo: string;
  sourceType: PriceSourceType;
  sourceName: string;
  sourceUrl: string;
  sourceChecksum: string;
  /**
   * Whether the published numbers include tax. Recorded per book rather than
   * assumed, because it decides whether an invoice line is compared on
   * `price_total` or `price_subtotal`.
   */
  taxInclusive: boolean;
  /** The currency the workbook's unlabelled columns are quoted in. */
  baseCurrency: string;
  notes: string;
  createdAt: string;
  createdBy: string;
  publishedAt: string;
  publishedBy: string;
  itemCount: number;
  /** Set when this book was created by copying another. */
  copiedFromId: string;
}

export interface PriceBookItem {
  id: string;
  priceBookId: string;
  sourceSheet: string;
  sourceRow: number;
  specialization: string;
  subcategory: string;
  rawProductCode: string;
  normalizedProductCode: string;
  odooProductId: number | null;
  courseName: string;
  normalizedCourseName: string;
  deliveryType: DeliveryType;
  /** The workbook's own spelling, kept so an import can always be explained. */
  rawDeliveryType: string;
  level: string;
  pricingScope: PricingScope;
  bundleName: string;
  paymentMethod: PriceMethodScope;
  currency: string;
  exactPrice: number | null;
  minimumPrice: number | null;
  maximumPrice: number | null;
  validFrom: string;
  validTo: string;
  country: string;
  company: string;
  active: boolean;
  /** True when a human must look before this row is used to judge a sale. */
  requiresReview: boolean;
  /** Product is suspended: it must not be sold at all. */
  onHold: boolean;
  note: string;
  rawSourceData: Record<string, string>;
}

/** A price rule reduced to what the engine needs to judge one invoice line. */
export interface PriceRule {
  id: string;
  priceBookId: string;
  normalizedProductCode: string;
  odooProductId: number | null;
  courseName: string;
  deliveryType: DeliveryType;
  pricingScope: PricingScope;
  paymentMethod: PriceMethodScope;
  currency: string;
  exactPrice: number | null;
  minimumPrice: number | null;
  maximumPrice: number | null;
  validFrom: string;
  validTo: string;
  country: string;
  active: boolean;
  requiresReview: boolean;
  onHold: boolean;
}

export type MatchType =
  "odoo_pricelist" | "odoo_product_id" | "exact_code" | "manual" | "alias" | "none";

export interface ProductMapping {
  priceItemId: string;
  odooProductId: number;
  odooProductCode: string;
  matchType: Exclude<MatchType, "none">;
  confidence: number;
  approvedBy: string;
  approvedAt: string;
}

/** One paid invoice line, reduced to what the audit needs. */
export interface AuditableInvoiceLine {
  invoiceLineId: string;
  invoiceNumber: string;
  moveType: string;
  isCreditNote: boolean;
  saleDate: string;
  invoiceDate: string;
  paymentDate: string;
  salesperson: string;
  salesTeam: string;
  company: string;
  country: string;
  currency: string;
  productCode: string;
  productName: string;
  odooProductId: number | null;
  quantity: number;
  /** Line total excluding tax, in the invoice currency, discounts applied. */
  untaxedTotal: number;
  /** Line total including tax, in the invoice currency, discounts applied. */
  totalInCurrency: number;
  /** Share of an invoice-level discount line allocated to this line. */
  allocatedDiscount: number;
  /** Odoo's sale-line chain; package prices are contextual, not course-list prices. */
  pricingContext: PricingContext;
  pricingContextName: string;
  odooPricingChecked: boolean;
  odooSaleOrderLineId: number | null;
  odooSaleOrderId: number | null;
  odooSaleOrderName: string;
  odooPricelistId: number | null;
  odooPricelistName: string;
  odooPricelistItemId: number | null;
  odooPricelistItemName: string;
  /** Tax-exclusive unit price agreed on the linked Odoo sale order line. */
  odooExpectedUnitPrice: number | null;
}

export interface PaymentRead {
  /** Normalized instrument, or `unknown` when the payment record did not say. */
  method: PaymentMethod;
  /** Every instrument seen on this invoice, for a mixed payment. */
  methods: PaymentMethod[];
  /** Untouched provider/journal strings, kept for audit. */
  raw: string[];
  /** Amount settled per instrument, in the invoice currency. */
  breakdown: { method: PaymentMethod; raw: string; amount: number }[];
  source: "account_payment" | "payments_widget" | "none";
}

export interface InvoicePriceAudit {
  invoiceLineId: string;
  invoiceNumber: string;
  priceBookId: string;
  priceBookVersion: number;
  priceItemId: string;
  paymentMethod: PaymentMethod;
  paymentMethodRaw: string;
  currency: string;
  quantity: number;
  actualUnitPrice: number;
  allowedMinimum: number | null;
  allowedMaximum: number | null;
  complianceStatus: ComplianceStatus;
  severity: ComplianceSeverity;
  varianceAmount: number;
  variancePercent: number | null;
  /** Positive shortfall against the floor, multiplied by quantity. */
  leakageAmount: number;
  matchType: MatchType;
  reason: string;
  auditedAt: string;
  saleDate: string;
  invoiceDate: string;
  paymentDate: string;
  salesperson: string;
  salesTeam: string;
  company: string;
  productCode: string;
  productName: string;
  priceSource: AuditPriceSource;
  pricingContext: PricingContext;
  pricingContextName: string;
  odooSaleOrderName: string;
  odooPricelistId: number | null;
  odooPricelistName: string;
  odooPricelistItemId: number | null;
  odooPricelistItemName: string;
}

export const DELIVERY_TYPES: DeliveryType[] = [
  "online",
  "recorded",
  "offline",
  "exam",
  "shipping",
  "certificate",
  "renewal",
  "unknown",
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  "tabby",
  "tamara",
  "cash",
  "cashier",
  "bank_transfer",
  "mixed",
  "unknown",
];

export const COMPLIANCE_STATUSES: ComplianceStatus[] = [
  "compliant",
  "compliant_package",
  "compliant_offer",
  "below_minimum",
  "above_list",
  "unmatched_product",
  "unknown_payment_method",
  "mixed_payment_review",
  "expired_offer",
  "package_price_unresolved",
  "excluded",
];
