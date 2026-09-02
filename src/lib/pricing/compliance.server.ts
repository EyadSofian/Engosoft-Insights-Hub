// Server-only orchestration: turn stored invoice lines into price verdicts.
//
// Cost is the design constraint here, not cleverness. Railway bills for a
// process that stays up, and Odoo answers slowly under load, so:
//
//   * Invoice facts come from the accounting rows already in PostgreSQL. This
//     module never re-reads invoices from Odoo and never changes how revenue is
//     calculated — it only reads what the accounting pipeline already stored.
//   * Odoo is touched for facts the accounting snapshot does not carry — the
//     settled payment instrument, quantity/product id, and the sale-line /
//     pricelist lineage that distinguishes a package component from a standalone
//     course. All are read in batches and cached, so a line is looked up once.
//   * A line is re-judged only when its own numbers changed, or the price book
//     that judged it did.
//   * Pages read `invoice_price_audits`. Opening the tab runs no audit at all.
import { readDashboardDataset } from "../dashboard-db.server.ts";
import { odooConfigured } from "../odoo.server.ts";
import {
  aggregateAudits,
  currentPublishedBook,
  ensurePricingSchema,
  itemToRule,
  listPaymentAliases,
  listPriceItems,
  listProductMappings,
  pricingDatabaseConfigured,
  publishedBookForDate,
  queryAudits,
  readAuditFingerprints,
  readAuditState,
  readStoredLineFacts,
  readStoredPayments,
  updatePriceItems,
  upsertProductMappings,
  writeAudits,
  writeAuditState,
  writeLineFacts,
  writePaymentReads,
  type AuditQuery,
} from "./pricing-db.server.ts";
import {
  allocateInvoiceDiscounts,
  auditLine,
  buildRuleIndex,
  type RuleIndex,
} from "./pricing-engine.ts";
import {
  PRICING_LINEAGE_VERSION,
  readInvoiceLineFacts,
  readPaymentMethods,
  resolveProductIdsByCode,
  resolveSaleOrderDates,
} from "./payment-methods.server.ts";
import { applyPublishedBundleOffer } from "./bundle-offers.ts";
import { normalizeProductCode, productCodeFromDisplayName, text } from "./pricing-normalize.ts";
import type {
  AuditableInvoiceLine,
  InvoicePriceAudit,
  PaymentRead,
  PriceBook,
  PriceRule,
} from "./pricing-types.ts";
import { createHash } from "node:crypto";

type Raw = Record<string, string>;

const str = (row: Raw, keys: string[]): string => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};

const number = (value: string): number => {
  const parsed = Number(String(value).replace(/[,\s$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const asDate = (value: string): string => {
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const slash = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!slash) return "";
  const month = Number(slash[1]);
  const day = Number(slash[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const isRefund = (row: Raw): boolean => {
  const move = str(row, ["Move", "Movement", "حركة"]);
  const type = str(row, ["Move Type", "move_type", "__odoo_move_type", "نوع الحركة"]).toLowerCase();
  return /^RINV/i.test(move) || type === "out_refund" || type.includes("credit note");
};

/**
 * Read the accounting snapshot into lines the engine can judge.
 *
 * Deliberately a read of the same rows the Accounting tab reports on, with the
 * same column names. Nothing is recomputed, so the audit cannot disagree with
 * the revenue figures beside it.
 */
export function toAuditableLines(rows: Raw[]): AuditableInvoiceLine[] {
  return rows
    .map((row): AuditableInvoiceLine => {
      const invoiceNumber = str(row, ["Move", "Movement", "حركة"]);
      const lineId =
        str(row, ["__odoo_line_id", "Invoice Line ID", "Move Line ID", "Line ID", "__odoo_id"]) ||
        createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 32);
      return {
        invoiceLineId: lineId,
        invoiceNumber,
        moveType: str(row, ["Move Type", "move_type", "__odoo_move_type"]),
        isCreditNote: isRefund(row),
        saleDate: "",
        invoiceDate: asDate(str(row, ["Invoice Date", "تاريخ الفاتورة"])),
        paymentDate: asDate(str(row, ["Payment Date", "Payment date", "تاريخ الدفع"])),
        salesperson: str(row, ["Salesperson", "مندوب المبيعات"]),
        salesTeam: str(row, ["Sales Team", "فريق المبيعات"]),
        company: str(row, ["Company", "الشركة"]),
        country: str(row, ["Country", "الدولة"]),
        currency: str(row, ["Currency", "العملة"]).toUpperCase(),
        // The accounting export has a code column in some builds and not in
        // others; where it is missing, Odoo's own `[code] name` rendering of the
        // product still carries it exactly.
        productCode:
          normalizeProductCode(str(row, ["Product Code", "Product Reference", "الرقم المرجعي"])) ||
          productCodeFromDisplayName(str(row, ["Product", "المنتج", "Course Name", "Course"])),
        productName: str(row, ["Product", "المنتج", "Course Name", "Course"]),
        odooProductId: Number(str(row, ["__odoo_product_id", "Product ID"])) || null,
        quantity: number(str(row, ["Quantity", "الكمية"])) || 0,
        untaxedTotal: number(str(row, ["Untaxed Total", "الإجمالي دون الضريبة"])),
        totalInCurrency: number(str(row, ["Total in Currency", "الإجمالي بالعملة"])),
        allocatedDiscount: 0,
        pricingContext: "unknown",
        pricingContextName: "",
        odooPricingChecked: false,
        odooSaleOrderLineId: null,
        odooSaleOrderId: null,
        odooSaleOrderName: "",
        odooPricelistId: null,
        odooPricelistName: "",
        odooPricelistItemId: null,
        odooPricelistItemName: "",
        odooExpectedUnitPrice: null,
        odooListUnitPrice: null,
        odooDiscountPercent: null,
        // Kept off the type: the order reference is only needed to look up the
        // order date, which is written back onto `saleDate` below.
      };
    })
    .filter((line) => !!line.invoiceLineId);
}

/** A line's own numbers. Changing any of them re-opens the verdict. */
function fingerprint(line: AuditableInvoiceLine, bookVersion: number): string {
  return createHash("sha256")
    .update(
      [
        line.invoiceNumber,
        line.productCode,
        line.quantity,
        line.untaxedTotal,
        line.totalInCurrency,
        line.currency,
        line.saleDate,
        line.invoiceDate,
        line.paymentDate,
        line.salesperson,
        line.allocatedDiscount,
        line.pricingContext,
        line.pricingContextName,
        line.odooSaleOrderLineId,
        line.odooPricelistId,
        line.odooPricelistItemId,
        line.odooExpectedUnitPrice,
        line.odooListUnitPrice,
        line.odooDiscountPercent,
        line.pricingContextItemId,
        bookVersion,
      ].join(""),
    )
    .digest("hex")
    .slice(0, 40);
}

export interface AuditRunOptions {
  /** Earliest payment/invoice date to look at. Defaults to the last 90 days. */
  from?: string;
  to?: string;
  /** Re-judge every line in the window, even unchanged ones. */
  force?: boolean;
  /** Skip the Odoo reads entirely; unseen invoices stay `unknown`. */
  offline?: boolean;
  /** Ceiling on invoices whose payment is read from Odoo in one run. */
  paymentBudget?: number;
}

export interface AuditRunResult {
  ok: boolean;
  bookId: string;
  bookVersion: number;
  bookName: string;
  windowFrom: string;
  windowTo: string;
  candidateLines: number;
  auditedLines: number;
  skippedUnchanged: number;
  paymentsRead: number;
  lineFactsRead: number;
  /** Lines whose stored id resolved to a different invoice in Odoo. */
  lineFactsRejected: number;
  linesMissingQuantity: number;
  productsResolved: number;
  odooCalls: number;
  unknownPaymentValues: string[];
  durationMs: number;
  error: string;
}

const DAY = 24 * 60 * 60 * 1000;

const isoDay = (value: Date): string => value.toISOString().slice(0, 10);

/** Books keyed by the window they cover, so a line finds the price of its own day. */
class BookResolver {
  private cache = new Map<string, PriceBook | null>();
  private rules = new Map<string, RuleIndex>();
  private items = new Map<string, Awaited<ReturnType<typeof listPriceItems>>>();

  constructor(
    private readonly fallback: PriceBook | null,
    private readonly mappings: Awaited<ReturnType<typeof listProductMappings>>,
  ) {}

  async bookFor(date: string): Promise<PriceBook | null> {
    const key = date || "none";
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const book = date ? await publishedBookForDate(date) : this.fallback;
    const resolved = book ?? this.fallback;
    this.cache.set(key, resolved);
    return resolved;
  }

  async indexFor(book: PriceBook): Promise<RuleIndex> {
    const existing = this.rules.get(book.id);
    if (existing) return existing;
    const items = await this.itemsFor(book);
    const index = buildRuleIndex(items.map(itemToRule), this.mappings);
    this.rules.set(book.id, index);
    return index;
  }

  async itemsFor(book: PriceBook): Promise<Awaited<ReturnType<typeof listPriceItems>>> {
    const existing = this.items.get(book.id);
    if (existing) return existing;
    const items = await listPriceItems(book.id);
    this.items.set(book.id, items);
    return items;
  }
}

/**
 * Run (or refresh) the audit.
 *
 * Safe to call repeatedly: the fingerprint check means a second run over an
 * unchanged window writes nothing and calls Odoo for nothing.
 */
export async function runPriceAudit(options: AuditRunOptions = {}): Promise<AuditRunResult> {
  const startedAt = Date.now();
  const to = options.to || isoDay(new Date());
  const from = options.from || isoDay(new Date(Date.now() - 90 * DAY));
  const empty: AuditRunResult = {
    ok: false,
    bookId: "",
    bookVersion: 0,
    bookName: "",
    windowFrom: from,
    windowTo: to,
    candidateLines: 0,
    auditedLines: 0,
    skippedUnchanged: 0,
    paymentsRead: 0,
    lineFactsRead: 0,
    lineFactsRejected: 0,
    linesMissingQuantity: 0,
    productsResolved: 0,
    odooCalls: 0,
    unknownPaymentValues: [],
    durationMs: 0,
    error: "",
  };

  if (!pricingDatabaseConfigured()) {
    return {
      ...empty,
      error: "DATABASE_URL is not configured.",
      durationMs: Date.now() - startedAt,
    };
  }
  await ensurePricingSchema();

  const book = await currentPublishedBook();
  if (!book) {
    return {
      ...empty,
      error: "No price book has been published yet. Import one and publish it first.",
      durationMs: Date.now() - startedAt,
    };
  }

  const snapshot = await readDashboardDataset("accounting");
  const inWindow = snapshot.rows.filter((row) => {
    const date =
      asDate(str(row, ["Payment Date", "Payment date", "تاريخ الدفع"])) ||
      asDate(str(row, ["Invoice Date", "تاريخ الفاتورة"]));
    return !!date && date >= from && date <= to;
  });

  const lines = toAuditableLines(inWindow);
  const orderRefByLine = new Map<string, string>();
  inWindow.forEach((row, index) => {
    const reference = str(row, ["Sales Order #", "Sales Order", "Order #", "SO #"]);
    const line = lines[index];
    if (line && reference) orderRefByLine.set(line.invoiceLineId, reference);
  });

  const mappings = await listProductMappings();
  const resolver = new BookResolver(book, mappings);
  let odooCalls = 0;
  let productsResolved = 0;
  const unknownPaymentValues: string[] = [];

  /* --- order dates: the price book is chosen by when the price was agreed --- */
  if (!options.offline && odooConfigured()) {
    try {
      const references = [...new Set([...orderRefByLine.values()])];
      const dates = await resolveSaleOrderDates(references);
      odooCalls += Math.ceil(references.length / 500);
      for (const line of lines) {
        const reference = orderRefByLine.get(line.invoiceLineId);
        line.saleDate = (reference && dates.get(reference)) || "";
      }
    } catch {
      // Order dates are an improvement on the documented fallback, not a
      // prerequisite. Without them every line uses its invoice date.
    }
  }

  /* --- quantity and product, for exports that omit them -------------------- */
  // The stored accounting rows are an export built for revenue reporting: in
  // this deployment they carry no quantity at all. A per-unit comparison cannot
  // be made up from a line total, and assuming one seat would quietly turn a
  // three-seat invoice into one very expensive seat, so the real numbers are
  // read from `account.move.line` by id — once per line, then cached.
  let lineFactsRead = 0;
  let lineFactsRejected = 0;
  // Every line needs the Odoo sale-line lineage once, even when the accounting
  // export already carries quantity. That lineage is what distinguishes a
  // standalone course from the same course sold as one component of a package.
  const needsFacts = lines;
  if (needsFacts.length) {
    const cached = await readStoredLineFacts(needsFacts.map((line) => line.invoiceLineId));
    const missing = needsFacts.filter((line) => {
      const fact = cached.get(line.invoiceLineId);
      return (
        options.force ||
        !fact?.odooPricingChecked ||
        fact.pricingLineageVersion !== PRICING_LINEAGE_VERSION
      );
    });

    if (missing.length && !options.offline && odooConfigured()) {
      try {
        const read = await readInvoiceLineFacts(
          missing.map((line) => ({
            invoiceLineId: line.invoiceLineId,
            invoiceNumber: line.invoiceNumber,
          })),
        );
        odooCalls += read.odooCalls;
        const fresh = [...read.facts.values()].map((fact) => ({
          ...fact,
          odooProductId: fact.odooProductId || null,
        }));
        if (fresh.length) await writeLineFacts(fresh);
        for (const fact of read.facts.values())
          cached.set(fact.invoiceLineId, { ...fact, odooProductId: fact.odooProductId || null });
        lineFactsRead = read.facts.size;
        // A high number here means the stored line ids do not identify Odoo
        // invoice lines, which is the one assumption this enrichment makes.
        lineFactsRejected = read.rejected;
      } catch {
        // Without them the affected lines are excluded with a reason, which is
        // honest. It must not fail the run for every other line.
      }
    }

    for (const line of lines) {
      const fact = cached.get(line.invoiceLineId);
      if (!fact) continue;
      if (line.quantity <= 0 && fact.quantity > 0) line.quantity = fact.quantity;
      if (!line.odooProductId && fact.odooProductId) line.odooProductId = fact.odooProductId;
      if (!line.productCode && fact.productCode) line.productCode = fact.productCode;
      // Prefer the invoice line's own amounts when the export rounded them.
      if (!line.untaxedTotal && fact.priceSubtotal) line.untaxedTotal = fact.priceSubtotal;
      if (!line.totalInCurrency && fact.priceTotal) line.totalInCurrency = fact.priceTotal;
      line.pricingContext = fact.pricingContext;
      line.pricingContextName = fact.pricingContextName;
      line.odooPricingChecked = fact.odooPricingChecked;
      line.odooSaleOrderLineId = fact.saleOrderLineId;
      line.odooSaleOrderId = fact.saleOrderId;
      line.odooSaleOrderName = fact.saleOrderName;
      line.odooPricelistId = fact.pricelistId;
      line.odooPricelistName = fact.pricelistName;
      line.odooPricelistItemId = fact.pricelistItemId;
      line.odooPricelistItemName = fact.pricelistItemName;
      line.odooExpectedUnitPrice = fact.expectedUnitPrice;
      line.odooListUnitPrice = fact.priceUnit;
      line.odooDiscountPercent = fact.discount;
    }
  }
  const linesMissingQuantity = lines.filter((line) => line.quantity <= 0).length;

  /* --- payment instruments ------------------------------------------------- */
  const invoiceNumbers = [...new Set(lines.map((line) => line.invoiceNumber).filter(Boolean))];
  const stored = await readStoredPayments(invoiceNumbers);
  const missing = invoiceNumbers.filter((invoice) => !stored.has(invoice));
  let paymentsRead = 0;

  if (missing.length && !options.offline && odooConfigured()) {
    try {
      const aliases = await listPaymentAliases();
      const budget = Math.max(1, options.paymentBudget ?? 4000);
      const batch = missing.slice(0, budget);
      const result = await readPaymentMethods(batch, aliases);
      odooCalls += result.diagnostics.odooCalls;
      unknownPaymentValues.push(...result.diagnostics.unknownRawValues);
      await writePaymentReads(
        [...result.reads.entries()].map(([invoiceNumber, read]) => ({
          invoiceNumber,
          method: read.method,
          methods: read.methods,
          raw: read.raw,
          breakdown: read.breakdown,
          source: read.source,
          readAt: new Date().toISOString(),
        })),
      );
      for (const [invoice, read] of result.reads) {
        stored.set(invoice, {
          invoiceNumber: invoice,
          method: read.method,
          methods: read.methods,
          raw: read.raw,
          breakdown: read.breakdown,
          source: read.source,
          readAt: new Date().toISOString(),
        });
      }
      paymentsRead = batch.length;
    } catch (error) {
      // A payment read that fails leaves those invoices as `unknown`, which the
      // report shows as needing review. It must not fail the whole audit.
      unknownPaymentValues.push(
        `payment read failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /* --- product ids: the highest-ranked match in the specification ----------- */
  if (!options.offline && odooConfigured()) {
    try {
      const items = await listPriceItems(book.id);
      const unmapped = items.filter((item) => !item.odooProductId && item.normalizedProductCode);
      const codes = [...new Set(unmapped.map((item) => item.normalizedProductCode))];
      if (codes.length) {
        const resolved = await resolveProductIdsByCode(codes);
        odooCalls += Math.ceil(codes.length / 500);
        const updates = unmapped
          .map((item) => {
            const hit = resolved.get(item.normalizedProductCode);
            return hit
              ? { id: item.id, odooProductId: hit.id, code: item.normalizedProductCode }
              : null;
          })
          .filter((entry): entry is { id: string; odooProductId: number; code: string } => !!entry);

        if (updates.length) {
          // Recorded as an approved mapping as well, so the mapping screen can
          // show why a line matched and an operator can override it.
          await upsertProductMappings(
            updates.map((entry) => ({
              priceItemId: entry.id,
              odooProductId: entry.odooProductId,
              odooProductCode: entry.code,
              matchType: "exact_code" as const,
              confidence: 1,
              approvedBy: "system:code-match",
            })),
            "system:code-match",
          );
          await setResolvedProductIds(updates);
          productsResolved = updates.length;
        }
      }
    } catch {
      // Code matching already covers these lines; the id is an upgrade.
    }
  }

  /* --- judge --------------------------------------------------------------- */
  const byInvoice = new Map<string, AuditableInvoiceLine[]>();
  for (const line of lines) {
    byInvoice.set(line.invoiceNumber, [...(byInvoice.get(line.invoiceNumber) ?? []), line]);
  }

  const existingFingerprints = options.force
    ? new Map<string, string>()
    : await readAuditFingerprints();
  const pending: (InvoicePriceAudit & { lineFingerprint: string })[] = [];
  let skipped = 0;

  for (const [, invoiceLines] of byInvoice) {
    const firstLine = invoiceLines[0];
    const invoiceBook =
      (await resolver.bookFor(firstLine?.saleDate || firstLine?.invoiceDate || "")) ?? book;
    const payment: PaymentRead = stored.get(firstLine?.invoiceNumber || "")
      ? {
          method: stored.get(firstLine.invoiceNumber)!.method,
          methods: stored.get(firstLine.invoiceNumber)!.methods,
          raw: stored.get(firstLine.invoiceNumber)!.raw,
          breakdown: stored.get(firstLine.invoiceNumber)!.breakdown,
          source: stored.get(firstLine.invoiceNumber)!.source as PaymentRead["source"],
        }
      : { method: "unknown", methods: [], raw: [], breakdown: [], source: "none" };
    const allocated = allocateInvoiceDiscounts(invoiceLines, invoiceBook.taxInclusive);
    const invoiceItems = await resolver.itemsFor(invoiceBook);
    const contextualized = applyPublishedBundleOffer(
      allocated,
      payment,
      invoiceItems,
      invoiceBook.taxInclusive,
    );
    for (const line of contextualized) {
      const on = line.saleDate || line.invoiceDate;
      const lineBook = (await resolver.bookFor(on)) ?? book;
      const mark = fingerprint(line, lineBook.version);
      if (existingFingerprints.get(line.invoiceLineId) === mark) {
        skipped++;
        continue;
      }
      const index = await resolver.indexFor(lineBook);
      const audit = auditLine(
        line,
        payment,
        index,
        { taxInclusive: lineBook.taxInclusive },
        { id: lineBook.id, version: lineBook.version },
      );
      pending.push({ ...audit, lineFingerprint: mark });
    }
  }

  let error = "";
  try {
    await writeAudits(pending);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Writing audit rows failed.";
  }
  await writeAuditState({
    bookId: book.id,
    bookVersion: book.version,
    auditedLines: pending.length,
    windowFrom: from,
    windowTo: to,
    error,
  });
  invalidateComplianceCache();

  return {
    ok: !error,
    bookId: book.id,
    bookVersion: book.version,
    bookName: book.name,
    windowFrom: from,
    windowTo: to,
    candidateLines: lines.length,
    auditedLines: pending.length,
    skippedUnchanged: skipped,
    paymentsRead,
    lineFactsRead,
    lineFactsRejected,
    linesMissingQuantity,
    productsResolved,
    odooCalls,
    unknownPaymentValues: [...new Set(unknownPaymentValues)].slice(0, 25),
    durationMs: Date.now() - startedAt,
    error,
  };
}

/** Write resolved Odoo product ids back onto the draft rows that carry the code. */
async function setResolvedProductIds(
  updates: { id: string; odooProductId: number }[],
): Promise<void> {
  try {
    await updatePriceItems(
      updates.map((entry) => ({ id: entry.id, patch: { odooProductId: entry.odooProductId } })),
      "system:code-match",
      "Matched to an Odoo product by exact code",
    );
  } catch {
    // A published book refuses in-place edits, which is correct. The mapping row
    // is already stored and the engine reads it from there.
  }
}

/**
 * How much of the audit the stored accounting snapshot can actually support.
 *
 * Reported rather than assumed: the audit joins on the product code and the
 * invoice line id, and if a sync drops either the report goes quiet instead of
 * wrong. Counts only — no invoice, no partner, no amount leaves this function.
 */
export async function accountingReadiness(days = 90): Promise<{
  rows: number;
  inWindow: number;
  withLineId: number;
  withProductCode: number;
  codeFromColumn: number;
  codeFromDisplayName: number;
  lineFactsCached: number;
  withCurrency: number;
  withQuantity: number;
  creditNotes: number;
  currencies: string[];
  windowFrom: string;
  syncedAt: string;
  error: string;
}> {
  const from = isoDay(new Date(Date.now() - days * DAY));
  const blank = {
    rows: 0,
    inWindow: 0,
    withLineId: 0,
    withProductCode: 0,
    codeFromColumn: 0,
    codeFromDisplayName: 0,
    lineFactsCached: 0,
    withCurrency: 0,
    withQuantity: 0,
    creditNotes: 0,
    currencies: [] as string[],
    windowFrom: from,
    syncedAt: "",
    error: "",
  };
  try {
    const snapshot = await readDashboardDataset("accounting");
    const inWindow = snapshot.rows.filter((row) => {
      const date =
        asDate(str(row, ["Payment Date", "Payment date", "تاريخ الدفع"])) ||
        asDate(str(row, ["Invoice Date", "تاريخ الفاتورة"]));
      return !!date && date >= from;
    });
    const lines = toAuditableLines(inWindow);
    // Where the code came from matters: a column the export carries is one
    // thing, a code recovered from Odoo's `[code] name` rendering is another,
    // and an operator looking at a low coverage number needs to know which.
    const codeFromColumn = inWindow.filter((row) =>
      normalizeProductCode(str(row, ["Product Code", "Product Reference", "الرقم المرجعي"])),
    ).length;
    const cachedFacts = await readStoredLineFacts(lines.map((line) => line.invoiceLineId));
    return {
      ...blank,
      rows: snapshot.rows.length,
      inWindow: inWindow.length,
      withLineId: inWindow.filter((row) =>
        str(row, ["__odoo_line_id", "Invoice Line ID", "Move Line ID", "__odoo_id"]),
      ).length,
      withProductCode: lines.filter((line) => !!line.productCode).length,
      codeFromColumn,
      codeFromDisplayName: lines.filter((line) => !!line.productCode).length - codeFromColumn,
      lineFactsCached: cachedFacts.size,
      withCurrency: lines.filter((line) => !!line.currency).length,
      // Zero here is expected on an export with no quantity column: the audit
      // reads it from `account.move.line` on its first run and caches it.
      withQuantity: lines.filter(
        (line) => line.quantity > 0 || (cachedFacts.get(line.invoiceLineId)?.quantity ?? 0) > 0,
      ).length,
      creditNotes: lines.filter((line) => line.isCreditNote).length,
      currencies: [...new Set(lines.map((line) => line.currency).filter(Boolean))].sort(),
      syncedAt: snapshot.syncedAt,
    };
  } catch (error) {
    return {
      ...blank,
      error: error instanceof Error ? error.message : "The accounting snapshot could not be read.",
    };
  }
}

/* --- read paths ------------------------------------------------------------ */

interface CacheEntry {
  at: number;
  value: unknown;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function invalidateComplianceCache(): void {
  cache.clear();
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export interface ComplianceSnapshot {
  configured: boolean;
  book: PriceBook | null;
  totals: Record<string, number>;
  byStatus: { status: string; lines: number; leakage: number }[];
  bySalesperson: { salesperson: string; lines: number; breaches: number; leakage: number }[];
  byCurrency: { currency: string; breaches: number; leakage: number }[];
  state: Awaited<ReturnType<typeof readAuditState>>;
  /** How old the stored audit is. The page shows this rather than re-running. */
  freshness: { lastRunAt: string; staleHours: number | null };
  error: string;
}

/**
 * Everything the KPI row needs, aggregated in PostgreSQL.
 *
 * A failure here returns an empty-but-labelled snapshot rather than throwing, so
 * a pricing outage cannot take the rest of the dashboard down with it.
 */
export async function complianceSnapshot(query: AuditQuery): Promise<ComplianceSnapshot> {
  const blank: ComplianceSnapshot = {
    configured: pricingDatabaseConfigured(),
    book: null,
    totals: {},
    byStatus: [],
    bySalesperson: [],
    byCurrency: [],
    state: {
      lastRunAt: "",
      lastBookVersion: 0,
      auditedLines: 0,
      windowFrom: "",
      windowTo: "",
      lastError: "",
    },
    freshness: { lastRunAt: "", staleHours: null },
    error: "",
  };
  if (!pricingDatabaseConfigured()) {
    return { ...blank, error: "DATABASE_URL is not configured on this deployment." };
  }

  try {
    return await cached(`compliance:${JSON.stringify(query)}`, async () => {
      await ensurePricingSchema();
      const [book, aggregate, state] = await Promise.all([
        currentPublishedBook(),
        aggregateAudits(query),
        readAuditState(),
      ]);
      const staleHours = state.lastRunAt
        ? Math.max(0, (Date.now() - Date.parse(state.lastRunAt)) / (60 * 60 * 1000))
        : null;
      return {
        ...blank,
        configured: true,
        book,
        totals: aggregate.totals,
        byStatus: aggregate.byStatus,
        bySalesperson: aggregate.bySalesperson,
        byCurrency: aggregate.byCurrency,
        state,
        freshness: { lastRunAt: state.lastRunAt, staleHours },
      };
    });
  } catch (error) {
    return {
      ...blank,
      error:
        error instanceof Error ? error.message : "The price compliance store could not be read.",
    };
  }
}

export async function complianceRows(
  query: AuditQuery,
): Promise<{ rows: InvoicePriceAudit[]; total: number; error: string }> {
  if (!pricingDatabaseConfigured()) {
    return { rows: [], total: 0, error: "DATABASE_URL is not configured on this deployment." };
  }
  try {
    const result = await queryAudits(query);
    return { ...result, error: "" };
  } catch (error) {
    return {
      rows: [],
      total: 0,
      error: error instanceof Error ? error.message : "The audit table could not be read.",
    };
  }
}

/* --- alerts ---------------------------------------------------------------- */

export interface AlertRow extends InvoicePriceAudit {
  alertKey: string;
}

export const alertKeyFor = (audit: InvoicePriceAudit): string =>
  `${audit.invoiceLineId}|${audit.priceBookVersion}|${audit.complianceStatus}`;

/**
 * The findings worth telling somebody about.
 *
 * Ordered by how much a person can act on them: a large discount below a
 * published floor first, then a small one, then the cases where the data itself
 * needs attention, then sales above list, which are only ever informational.
 */
export async function pricingAlerts(
  query: AuditQuery,
): Promise<{ rows: AlertRow[]; total: number; error: string }> {
  const result = await complianceRows({
    ...query,
    limit: query.limit ?? 100,
  });
  const severityRank: Record<string, number> = {
    critical: 0,
    warning: 1,
    needs_review: 2,
    informational: 3,
    none: 4,
  };
  const rows = result.rows
    .filter((audit) => audit.severity !== "none")
    .sort(
      (a, b) =>
        (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
        b.leakageAmount - a.leakageAmount,
    )
    .map((audit) => ({ ...audit, alertKey: alertKeyFor(audit) }));
  return { rows, total: result.total, error: result.error };
}

export interface DigestResult {
  ok: boolean;
  sent: number;
  newFindings: number;
  suppressed: number;
  skipped: boolean;
  error: string;
}

/**
 * Send one digest of findings nobody has been told about yet.
 *
 * De-duplication is by line, price-book version and verdict, exactly as
 * specified, and the claim happens before the send: a re-run cannot resend, and
 * a genuinely new verdict on the same line still gets through.
 */
export async function sendPricingDigest(
  options: { from?: string; to?: string } = {},
): Promise<DigestResult> {
  const blank: DigestResult = {
    ok: false,
    sent: 0,
    newFindings: 0,
    suppressed: 0,
    skipped: false,
    error: "",
  };
  if (!pricingDatabaseConfigured()) return { ...blank, error: "DATABASE_URL is not configured." };

  const { claimAlerts } = await import("./pricing-db.server.ts");
  const alerts = await pricingAlerts({
    from: options.from,
    to: options.to,
    severity: undefined,
    limit: 200,
  });
  if (alerts.error) return { ...blank, error: alerts.error };

  const actionable = alerts.rows.filter(
    (row) => row.severity === "critical" || row.severity === "warning",
  );
  if (!actionable.length) return { ...blank, ok: true, skipped: true };

  const claimed = await claimAlerts(
    actionable.map((row) => ({
      alertKey: row.alertKey,
      invoiceLineId: row.invoiceLineId,
      version: row.priceBookVersion,
      status: row.complianceStatus,
    })),
    "telegram",
  );
  const fresh = actionable.filter((row) => claimed.has(row.alertKey));
  if (!fresh.length) {
    return { ...blank, ok: true, skipped: true, suppressed: actionable.length };
  }

  try {
    const { sendMessage, esc, reportLang } = await import("../telegram.server.ts");
    const { recipients } = await import("../subscribers.server.ts");
    const chats = await recipients();
    if (!chats.length) {
      return { ...blank, ok: true, skipped: true, newFindings: fresh.length };
    }
    const arabic = reportLang() === "ar";
    const header = arabic
      ? `<b>الفارق عن الحد الأدنى المنشور</b>\n${fresh.length} بند بيع تحت السعر المسموح`
      : `<b>Sold below the published floor</b>\n${fresh.length} invoice lines under the allowed price`;
    const body = fresh
      .slice(0, 20)
      .map(
        (row) =>
          `• ${esc(row.invoiceNumber)} — ${esc(row.productName || row.productCode)}\n  ${row.actualUnitPrice} ${esc(row.currency)} vs ${row.allowedMinimum} · ${esc(row.salesperson || "—")} · ${esc(row.paymentMethod)}`,
      )
      .join("\n");
    const footer =
      fresh.length > 20
        ? arabic
          ? `\n\n… و${fresh.length - 20} حالة أخرى في تبويب التنبيهات.`
          : `\n\n… and ${fresh.length - 20} more in the Alerts tab.`
        : "";

    let sent = 0;
    for (const chat of chats) {
      const result = await sendMessage(chat, `${header}\n\n${body}${footer}`);
      if (result.ok) sent++;
    }
    return {
      ok: true,
      sent,
      newFindings: fresh.length,
      suppressed: actionable.length - fresh.length,
      skipped: false,
      error: "",
    };
  } catch (error) {
    return {
      ...blank,
      newFindings: fresh.length,
      error: error instanceof Error ? error.message : "Sending the digest failed.",
    };
  }
}

/* --- catalogue read -------------------------------------------------------- */

export interface CatalogEntry {
  code: string;
  rawCode: string;
  courseName: string;
  specialization: string;
  subcategory: string;
  deliveryType: string;
  level: string;
  odooProductId: number | null;
  onHold: boolean;
  requiresReview: boolean;
  demand?: { orders: number; units: number };
  /** One row per currency and payment method the course is priced in. */
  prices: {
    id: string;
    sourceSheet: string;
    sourceRow: number;
    scope: string;
    bundleName: string;
    paymentMethod: string;
    currency: string;
    country: string;
    exact: number | null;
    minimum: number | null;
    maximum: number | null;
    validFrom: string;
    validTo: string;
    active: boolean;
    requiresReview: boolean;
    note: string;
  }[];
}

/**
 * Group the flat price rows into one card per course.
 *
 * A seller looks up a course, not a price rule. Collapsing the four payment
 * methods, the offer and the Egyptian price onto one card is what makes the
 * answer one search away instead of five filters away.
 */
export function groupCatalog(items: Awaited<ReturnType<typeof listPriceItems>>): CatalogEntry[] {
  const byCourse = new Map<string, CatalogEntry>();
  for (const item of items) {
    const key = [
      item.normalizedProductCode || item.normalizedCourseName,
      item.deliveryType,
      item.subcategory,
      item.level,
    ].join("");
    const entry = byCourse.get(key) ?? {
      code: item.normalizedProductCode,
      rawCode: item.rawProductCode,
      courseName: item.courseName,
      specialization: item.specialization,
      subcategory: item.subcategory,
      deliveryType: item.deliveryType,
      level: item.level,
      odooProductId: item.odooProductId,
      onHold: false,
      requiresReview: false,
      demand: { orders: 0, units: 0 },
      prices: [],
    };
    entry.onHold = entry.onHold || item.onHold;
    entry.requiresReview = entry.requiresReview || item.requiresReview;
    entry.odooProductId = entry.odooProductId ?? item.odooProductId;
    entry.prices.push({
      id: item.id,
      sourceSheet: item.sourceSheet,
      sourceRow: item.sourceRow,
      scope: item.pricingScope,
      bundleName: item.bundleName,
      paymentMethod: item.paymentMethod,
      currency: item.currency,
      country: item.country,
      exact: item.exactPrice,
      minimum: item.minimumPrice,
      maximum: item.maximumPrice,
      validFrom: item.validFrom,
      validTo: item.validTo,
      active: item.active,
      requiresReview: item.requiresReview,
      note: item.note,
    });
    byCourse.set(key, entry);
  }
  return [...byCourse.values()].sort(
    (a, b) =>
      a.specialization.localeCompare(b.specialization) ||
      a.subcategory.localeCompare(b.subcategory) ||
      a.courseName.localeCompare(b.courseName),
  );
}

export const auditText = text;
export type { PriceRule };
