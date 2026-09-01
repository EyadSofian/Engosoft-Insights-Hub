// Server-only: what a customer actually paid with.
//
// `AccountingRow` carries no payment instrument, and the price book prices four
// of them differently. The gap has to be closed from the payment side, because
// nothing on the invoice itself is evidence:
//
//   * Currency is not an instrument. SAR is Tabby, Tamara, cash and a bank
//     transfer.
//   * Country is not an instrument.
//   * The amount is not an instrument — inferring "it ends in 99, must be the
//     cash offer" is exactly the circular reasoning that would make this whole
//     audit worthless.
//   * `invoice_payment_term_id` is not an instrument. "30 days" says when, not
//     how, and Odoo installations routinely name terms after providers.
//
// So this module reads settled payments: `account.payment` reconciled against
// the invoice, falling back to the payments widget Odoo computes on the move.
// Both are read in batches keyed by invoice, never one query per invoice.
import {
  companyContext,
  m2oId,
  m2oName,
  odooCall,
  odooConfigured,
  searchRead,
  type M2O,
} from "../odoo.server.ts";
import { combinePaymentMethods, normalizePaymentMethod, text } from "./pricing-normalize.ts";
import type { PaymentMethod, PaymentRead } from "./pricing-types.ts";
import { DEFAULT_PAYMENT_ALIASES } from "./pricing-normalize.ts";

interface OdooField {
  string?: string;
  type?: string;
  relation?: string;
}

export interface PaymentFieldReport {
  /** Fields this Odoo actually exposes, by model. Never includes a value. */
  available: Record<string, string[]>;
  /** The fields this reader will use, in the order it will try them. */
  chosen: string[];
  /** Things it looked for and did not find. */
  missing: string[];
  reachable: boolean;
  error: string;
}

const PAYMENT_NAME_FIELDS = [
  "payment_method_line_id",
  "payment_method_id",
  "journal_id",
  "payment_type",
  "partner_type",
  "payment_transaction_id",
  "x_studio_payment_method",
  "x_payment_method",
  "x_studio_payment_provider",
  "x_payment_provider",
  "x_studio_payment_gateway",
];

const MOVE_LINK_FIELDS = [
  "reconciled_invoice_ids",
  "reconciled_bill_ids",
  "invoice_ids",
  "move_id",
];

async function metadata(model: string): Promise<Record<string, OdooField>> {
  try {
    return await odooCall<Record<string, OdooField>>(model, "fields_get", [], {
      attributes: ["string", "type", "relation"],
      context: companyContext({ active_test: false }),
    });
  } catch {
    return {};
  }
}

/**
 * Report what this Odoo exposes, so the payment path can be audited without
 * anyone having to read the code or open a shell. Never returns a credential,
 * a URL or a database name.
 */
export async function describePaymentFields(): Promise<PaymentFieldReport> {
  if (!odooConfigured()) {
    return {
      available: {},
      chosen: [],
      missing: ["Odoo is not configured on this deployment."],
      reachable: false,
      error: "ODOO_LOGIN and ODOO_API_KEY are not set.",
    };
  }
  try {
    const [payment, move, transaction] = await Promise.all([
      metadata("account.payment"),
      metadata("account.move"),
      metadata("payment.transaction"),
    ]);

    const present = (source: Record<string, OdooField>, fields: string[]): string[] =>
      fields.filter((field) => !!source[field]);

    const chosen: string[] = [];
    const missing: string[] = [];
    const paymentNames = present(payment, PAYMENT_NAME_FIELDS);
    const links = present(payment, MOVE_LINK_FIELDS);

    if (paymentNames.length)
      chosen.push(...paymentNames.map((field) => `account.payment.${field}`));
    else missing.push("account.payment has no method, journal or provider field.");

    if (links.length) chosen.push(...links.map((field) => `account.payment.${field}`));
    else missing.push("account.payment exposes no link back to the invoice it settled.");

    if (move.invoice_payments_widget) chosen.push("account.move.invoice_payments_widget");
    else missing.push("account.move.invoice_payments_widget (fallback) is unavailable.");

    if (!Object.keys(payment).length) missing.push("account.payment is not readable by this user.");

    return {
      available: {
        "account.payment": present(payment, [
          ...PAYMENT_NAME_FIELDS,
          ...MOVE_LINK_FIELDS,
          "amount",
          "state",
          "date",
          "currency_id",
          "ref",
        ]),
        "account.move": present(move, [
          "invoice_payments_widget",
          "payment_state",
          "invoice_payment_term_id",
          "name",
          "invoice_origin",
          "invoice_date",
        ]),
        "payment.transaction": present(transaction, [
          "provider_id",
          "provider_code",
          "reference",
          "state",
          "amount",
        ]),
      },
      chosen,
      missing,
      reachable: true,
      error: "",
    };
  } catch (error) {
    return {
      available: {},
      chosen: [],
      missing: [],
      reachable: false,
      error: error instanceof Error ? error.message : "Odoo could not be reached.",
    };
  }
}

/* --- widget fallback ------------------------------------------------------- */

function parseWidget(value: unknown): { journal: string; amount: number; ref: string }[] {
  if (!value) return [];
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      try {
        parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
      } catch {
        return [];
      }
    }
  }
  const content = (parsed as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      journal: text(entry.journal_name ?? entry.payment_method_name ?? entry.name),
      amount: Number(entry.amount ?? 0) || 0,
      ref: text(entry.ref),
    }));
}

const chunks = <T>(values: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    out.push(values.slice(index, index + size));
  return out;
};

/**
 * The Odoo calls this reader makes, injectable so a test can count them.
 *
 * The promise the specification asks for — no per-invoice Odoo call — is only
 * worth making if something checks it, and nothing checks a promise made only in
 * a comment.
 */
export interface OdooReader {
  searchRead: typeof searchRead;
  metadata: (model: string) => Promise<Record<string, OdooField>>;
  configured: () => boolean;
}

const liveReader: OdooReader = {
  searchRead,
  metadata,
  configured: odooConfigured,
};

export interface PaymentLookupResult {
  reads: Map<string, PaymentRead>;
  diagnostics: {
    invoicesRequested: number;
    movesResolved: number;
    fromPayments: number;
    fromWidget: number;
    unresolved: number;
    odooCalls: number;
    unknownRawValues: string[];
  };
}

/**
 * Read the settled instrument for a batch of invoices.
 *
 * Cost shape: two calls to resolve moves and payments per 500 invoices, plus
 * one metadata call. It is deliberately not possible to call this per invoice
 * from a page render — the caller stores what comes back and re-reads only what
 * it has never seen.
 */
export async function readPaymentMethods(
  invoiceNumbers: string[],
  aliases: Record<string, PaymentMethod> = {},
  odoo: OdooReader = liveReader,
): Promise<PaymentLookupResult> {
  const merged = { ...DEFAULT_PAYMENT_ALIASES, ...aliases };
  const wanted = [...new Set(invoiceNumbers.map((value) => value.trim()).filter(Boolean))];
  const reads = new Map<string, PaymentRead>();
  const unknownRawValues = new Set<string>();
  let odooCalls = 0;
  let movesResolved = 0;
  let fromPayments = 0;
  let fromWidget = 0;

  if (!wanted.length || !odoo.configured()) {
    return {
      reads,
      diagnostics: {
        invoicesRequested: wanted.length,
        movesResolved: 0,
        fromPayments: 0,
        fromWidget: 0,
        unresolved: wanted.length,
        odooCalls: 0,
        unknownRawValues: [],
      },
    };
  }

  const [paymentMeta, moveMeta] = await Promise.all([
    odoo.metadata("account.payment"),
    odoo.metadata("account.move"),
  ]);
  odooCalls += 2;

  const nameFields = PAYMENT_NAME_FIELDS.filter((field) => !!paymentMeta[field]);
  const linkField = MOVE_LINK_FIELDS.find((field) => !!paymentMeta[field] && field !== "move_id");
  const hasWidget = !!moveMeta.invoice_payments_widget;

  // Resolve invoice numbers to move ids in batches, not one lookup per invoice.
  interface MoveRow {
    id: number;
    name?: string | false;
    invoice_payments_widget?: unknown;
  }
  const moveFields = ["id", "name", ...(hasWidget ? ["invoice_payments_widget"] : [])];
  const moves: MoveRow[] = [];
  for (const batch of chunks(wanted, 500)) {
    moves.push(
      ...(await odoo.searchRead<MoveRow>("account.move", [["name", "in", batch]], moveFields, {
        context: { active_test: false, bin_size: false },
      })),
    );
    odooCalls++;
  }
  movesResolved = moves.length;
  const nameByMoveId = new Map(moves.map((move) => [move.id, text(move.name)]));

  const record = (
    invoice: string,
    entries: { raw: string; amount: number }[],
    source: PaymentRead["source"],
  ): void => {
    const breakdown = entries
      .map((entry) => {
        const method = normalizePaymentMethod(entry.raw, merged);
        if (method === "unknown" && entry.raw) unknownRawValues.add(entry.raw);
        return { method, raw: entry.raw, amount: entry.amount };
      })
      .filter((entry) => entry.raw || entry.amount);
    const methods = breakdown.map((entry) => entry.method);
    reads.set(invoice, {
      method: combinePaymentMethods(methods),
      methods,
      raw: breakdown.map((entry) => entry.raw).filter(Boolean),
      breakdown,
      source,
    });
  };

  if (linkField && nameFields.length) {
    interface PaymentRow {
      id: number;
      amount?: number;
      state?: string | false;
      [key: string]: unknown;
    }
    const paymentFields = [
      "id",
      "amount",
      ...(paymentMeta.state ? ["state"] : []),
      ...nameFields,
      linkField,
    ];
    const moveIds = moves.map((move) => move.id);
    const byInvoice = new Map<string, { raw: string; amount: number }[]>();

    for (const batch of chunks(moveIds, 500)) {
      const payments = await odoo.searchRead<PaymentRow>(
        "account.payment",
        [[linkField, "in", batch]],
        paymentFields,
        { context: { active_test: false } },
      );
      odooCalls++;
      for (const payment of payments) {
        const state = text(payment.state);
        // A draft or cancelled payment settled nothing.
        if (state && state !== "posted" && state !== "paid" && state !== "reconciled") continue;

        // Most specific name first: a payment-method line names the instrument,
        // a journal names where it landed, a transaction names the provider.
        const raw =
          text(m2oName(payment.payment_method_line_id as M2O)) ||
          text(m2oName(payment.payment_method_id as M2O)) ||
          text(payment.x_studio_payment_method) ||
          text(payment.x_payment_method) ||
          text(payment.x_studio_payment_provider) ||
          text(payment.x_payment_provider) ||
          text(payment.x_studio_payment_gateway) ||
          text(m2oName(payment.payment_transaction_id as M2O)) ||
          text(m2oName(payment.journal_id as M2O));

        const linked = payment[linkField];
        const ids = Array.isArray(linked)
          ? linked.map((value) => (Array.isArray(value) ? m2oId(value as M2O) : Number(value)))
          : [m2oId(linked as M2O)];
        for (const id of ids) {
          const invoice = nameByMoveId.get(id);
          if (!invoice) continue;
          byInvoice.set(invoice, [
            ...(byInvoice.get(invoice) ?? []),
            { raw, amount: Number(payment.amount ?? 0) || 0 },
          ]);
        }
      }
    }

    for (const [invoice, entries] of byInvoice) {
      record(invoice, entries, "account_payment");
      fromPayments++;
    }
  }

  // Fallback for invoices with no reconciled `account.payment` row — settlement
  // through a statement line, or a build that links payments differently.
  if (hasWidget) {
    for (const move of moves) {
      const invoice = text(move.name);
      if (!invoice || reads.has(invoice)) continue;
      const entries = parseWidget(move.invoice_payments_widget);
      if (!entries.length) continue;
      record(
        invoice,
        entries.map((entry) => ({ raw: entry.journal || entry.ref, amount: entry.amount })),
        "payments_widget",
      );
      fromWidget++;
    }
  }

  // Everything still missing is recorded as unknown on purpose. A blank is a
  // fact about the payment record, and the audit shows it as "needs review"
  // rather than inventing an instrument for it.
  for (const invoice of wanted) {
    if (reads.has(invoice)) continue;
    reads.set(invoice, {
      method: "unknown",
      methods: [],
      raw: [],
      breakdown: [],
      source: "none",
    });
  }

  return {
    reads,
    diagnostics: {
      invoicesRequested: wanted.length,
      movesResolved,
      fromPayments,
      fromWidget,
      unresolved: wanted.length - fromPayments - fromWidget,
      odooCalls,
      unknownRawValues: [...unknownRawValues].slice(0, 50),
    },
  };
}

/* --- invoice line facts ---------------------------------------------------- */

export interface InvoiceLineFact {
  invoiceLineId: string;
  invoiceNumber: string;
  odooProductId: number;
  productCode: string;
  quantity: number;
  priceUnit: number;
  discount: number;
  priceSubtotal: number;
  priceTotal: number;
}

/**
 * Read quantity, product and price straight off the invoice lines.
 *
 * The stored accounting snapshot is an export built for revenue reporting, and
 * it carries neither a quantity nor a product code — which are exactly the two
 * fields a per-unit price comparison needs. Rather than assume a quantity of one
 * (a three-seat invoice would then read as one very expensive seat), they are
 * read from `account.move.line` by id, in batches, and cached.
 *
 * Every row is validated before it is trusted: the line's own move name has to
 * equal the invoice number already stored against that line. A stored id that
 * turns out to identify something else in Odoo is dropped rather than silently
 * attaching another invoice's quantity to this one.
 */
export async function readInvoiceLineFacts(
  lines: { invoiceLineId: string; invoiceNumber: string }[],
  odoo: OdooReader = liveReader,
): Promise<{ facts: Map<string, InvoiceLineFact>; odooCalls: number; rejected: number }> {
  const facts = new Map<string, InvoiceLineFact>();
  let odooCalls = 0;
  let rejected = 0;

  const expected = new Map<string, string>();
  for (const line of lines) {
    const id = Number(line.invoiceLineId);
    if (Number.isInteger(id) && id > 0) expected.set(String(id), line.invoiceNumber);
  }
  if (!expected.size || !odoo.configured()) return { facts, odooCalls, rejected };

  const meta = await odoo.metadata("account.move.line");
  odooCalls++;
  if (!meta.id) return { facts, odooCalls, rejected };

  const wanted = [
    "id",
    "move_id",
    "product_id",
    "quantity",
    "price_unit",
    "discount",
    "price_subtotal",
    "price_total",
  ].filter((field) => !!meta[field]);
  if (!wanted.includes("quantity")) return { facts, odooCalls, rejected };

  interface LineRow {
    id: number;
    move_id?: M2O;
    product_id?: M2O;
    quantity?: number;
    price_unit?: number;
    discount?: number;
    price_subtotal?: number;
    price_total?: number;
  }

  const ids = [...expected.keys()].map(Number);
  for (const batch of chunks(ids, 500)) {
    const rows = await odoo.searchRead<LineRow>(
      "account.move.line",
      [["id", "in", batch]],
      wanted,
      { context: { active_test: false } },
    );
    odooCalls++;
    for (const row of rows) {
      const key = String(row.id);
      const invoiceNumber = expected.get(key);
      if (!invoiceNumber) continue;
      const moveName = text(m2oName(row.move_id));
      if (moveName && invoiceNumber && moveName !== invoiceNumber) {
        rejected++;
        continue;
      }
      facts.set(key, {
        invoiceLineId: key,
        invoiceNumber: moveName || invoiceNumber,
        odooProductId: m2oId(row.product_id),
        productCode: "",
        quantity: Number(row.quantity ?? 0) || 0,
        priceUnit: Number(row.price_unit ?? 0) || 0,
        discount: Number(row.discount ?? 0) || 0,
        priceSubtotal: Number(row.price_subtotal ?? 0) || 0,
        priceTotal: Number(row.price_total ?? 0) || 0,
      });
    }
  }
  return { facts, odooCalls, rejected };
}

/**
 * Odoo product ids for a batch of default codes.
 *
 * The accounting snapshot stores a product code, not an id, so the highest
 * ranked match in the specification would otherwise be unreachable. One query
 * per 500 codes turns it back on without touching the accounting pipeline.
 */
export async function resolveProductIdsByCode(
  codes: string[],
): Promise<Map<string, { id: number; name: string }>> {
  const out = new Map<string, { id: number; name: string }>();
  const wanted = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
  if (!wanted.length || !odooConfigured()) return out;

  interface ProductRow {
    id: number;
    default_code?: string | false;
    display_name?: string | false;
  }
  for (const batch of chunks(wanted, 500)) {
    const products = await searchRead<ProductRow>(
      "product.product",
      [["default_code", "in", batch]],
      ["id", "default_code", "display_name"],
      { context: { active_test: false } },
    );
    for (const product of products) {
      const code = text(product.default_code).toUpperCase();
      if (!code || out.has(code)) continue;
      out.set(code, { id: product.id, name: text(product.display_name) });
    }
  }
  return out;
}

/**
 * Order dates for a batch of sales orders.
 *
 * The price book version is chosen by the date the price was agreed, which is
 * the order date. Invoice date is the documented fallback; payment date is
 * never used for this.
 */
export async function resolveSaleOrderDates(references: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(references.map((value) => value.trim()).filter(Boolean))];
  if (!wanted.length || !odooConfigured()) return out;

  interface OrderRow {
    id: number;
    name?: string | false;
    date_order?: string | false;
  }
  for (const batch of chunks(wanted, 500)) {
    const orders = await searchRead<OrderRow>(
      "sale.order",
      [["name", "in", batch]],
      ["id", "name", "date_order"],
      { context: { active_test: false } },
    );
    for (const order of orders) {
      const name = text(order.name);
      const date = text(order.date_order).slice(0, 10);
      if (name && date) out.set(name, date);
    }
  }
  return out;
}
