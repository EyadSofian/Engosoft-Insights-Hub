import { canonicalCourseValue } from "./course-taxonomy";
import { DEFAULT_FX_RATES, type FxRates } from "./fx-rates";
import { m2oId, m2oName, odooConfig, searchRead, type M2O } from "./odoo.server";
import type { AccountingRow } from "./types";

type CreditMove = {
  id: number;
  name: string | false;
  invoice_date: string | false;
  state: string | false;
  move_type: string | false;
  amount_total: number;
  amount_untaxed: number;
  currency_id: M2O;
  company_id: M2O;
  partner_id: M2O;
};

type CreditReportLine = {
  id: number;
  move_id: M2O;
  product_id: M2O;
  product_categ_id: M2O;
  quantity: number;
  price_total: number;
  price_subtotal: number;
};

export interface CreditNoteDocument {
  id: number;
  movement: string;
  invoiceDate: string;
  company: string;
  partner: string;
  currency: string;
  amount: number;
  odooUrl: string;
  inAccountingSnapshot: boolean;
}

export interface CreditNoteReconciliation {
  status: "live" | "unavailable" | "not_applicable";
  documents: CreditNoteDocument[];
  addedDocuments: number;
  addedUsd: number;
  unsupportedCurrencies: string[];
}

const cache = new Map<
  string,
  { expires: number; promise: Promise<{ moves: CreditMove[]; lines: CreditReportLine[] }> }
>();

async function readPostedCreditNotes(from: string, to: string) {
  const cfg = odooConfig();
  const domain: [string, string, unknown][] = [
    ["move_type", "=", "out_refund"],
    ["state", "=", "posted"],
    ["invoice_date", ">=", from || cfg.startDate],
    ["company_id", "in", cfg.pnlCompanyIds],
  ];
  if (to) domain.push(["invoice_date", "<=", to]);
  const policy = { attempts: 1, timeoutMs: 18_000 };
  const moves = await searchRead<CreditMove>(
    "account.move",
    domain,
    [
      "id",
      "name",
      "invoice_date",
      "state",
      "move_type",
      "amount_total",
      "amount_untaxed",
      "currency_id",
      "company_id",
      "partner_id",
    ],
    {
      order: "invoice_date desc,id desc",
      policy,
      context: { active_test: false, allowed_company_ids: cfg.pnlCompanyIds },
    },
  );
  const lines = moves.length
    ? await searchRead<CreditReportLine>(
        "account.invoice.report",
        [["move_id", "in", moves.map((move) => move.id)]],
        [
          "id",
          "move_id",
          "product_id",
          "product_categ_id",
          "quantity",
          "price_total",
          "price_subtotal",
        ],
        { policy, context: { active_test: false, allowed_company_ids: cfg.pnlCompanyIds } },
      )
    : [];
  return { moves, lines };
}

function cachedPostedCreditNotes(from: string, to: string) {
  const key = `${from}|${to}`;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  const promise = readPostedCreditNotes(from, to);
  cache.set(key, { expires: Date.now() + 5 * 60_000, promise });
  void promise.catch(() => cache.delete(key));
  return promise;
}

function usdAmount(amount: number, currency: string, rates: FxRates): number | null {
  const code = currency.toUpperCase();
  if (code === "USD") return amount;
  if (code === "SAR") return amount / rates.SAR;
  if (code === "EGP") return amount / rates.EGP;
  if (code === "AED") return amount * 0.27; // Same emergency AED rate as the direct Accounting reader.
  return null;
}

/** Supplements only entire posted Odoo credit notes absent from the invoice-line snapshot. */
export function reconcileCreditNotes(
  snapshot: AccountingRow[],
  moves: CreditMove[],
  lines: CreditReportLine[],
  rates: FxRates = DEFAULT_FX_RATES,
  odooUrl = odooConfig().url,
  company = "",
): { rows: AccountingRow[]; reconciliation: CreditNoteReconciliation } {
  const existing = new Set(snapshot.filter((row) => row.isCreditNote).map((row) => row.movement));
  const byMove = new Map<number, CreditReportLine[]>();
  for (const line of lines) {
    const id = m2oId(line.move_id);
    const group = byMove.get(id) ?? [];
    group.push(line);
    byMove.set(id, group);
  }
  const added: AccountingRow[] = [];
  const documents: CreditNoteDocument[] = [];
  const unsupported = new Set<string>();
  let addedDocuments = 0;
  let addedUsd = 0;

  for (const move of moves) {
    if (move.move_type !== "out_refund" || move.state !== "posted") continue;
    const movement = String(move.name || "").trim();
    const invoiceDate = String(move.invoice_date || "").slice(0, 10);
    const companyName = m2oName(move.company_id);
    if (!movement || !invoiceDate || (company && companyName !== company)) continue;
    const currency = m2oName(move.currency_id).trim().toUpperCase();
    const usd = usdAmount(-Math.abs(Number(move.amount_total) || 0), currency, rates);
    const inAccountingSnapshot = existing.has(movement);
    documents.push({
      id: move.id,
      movement,
      invoiceDate,
      company: companyName,
      partner: m2oName(move.partner_id),
      currency,
      amount: -Math.abs(Number(move.amount_total) || 0),
      odooUrl: `${odooUrl.replace(/\/$/, "")}/web#id=${move.id}&model=account.move&view_type=form`,
      inAccountingSnapshot,
    });
    if (inAccountingSnapshot) continue;
    if (usd === null) {
      unsupported.add(currency || "—");
      continue;
    }
    addedDocuments++;
    addedUsd += usd;
    const reportLines = byMove.get(move.id) ?? [];
    const items = reportLines.length ? reportLines : [null];
    const totalWeight = reportLines.reduce(
      (sum, line) => sum + Math.abs(Number(line.price_total) || 0),
      0,
    );
    const subtotalWeight = reportLines.reduce(
      (sum, line) => sum + Math.abs(Number(line.price_subtotal) || 0),
      0,
    );
    for (const [index, line] of items.entries()) {
      const weight =
        totalWeight > 0 && line
          ? Math.abs(Number(line.price_total) || 0) / totalWeight
          : 1 / items.length;
      const untaxedWeight =
        subtotalWeight > 0 && line
          ? Math.abs(Number(line.price_subtotal) || 0) / subtotalWeight
          : 1 / items.length;
      const product = line ? m2oName(line.product_id) : "Credit note (move-level)";
      const category = line ? m2oName(line.product_categ_id) : "Unclassified";
      const course = canonicalCourseValue("", product, category);
      const amount = -Math.abs(Number(move.amount_total) || 0) * weight;
      const lineUsd = usd * weight;
      added.push({
        id: line ? `odoo-credit:${line.id}` : `odoo-credit:${move.id}:${index}`,
        movement,
        moveType: "out_refund",
        isCreditNote: true,
        paymentDate: "",
        invoiceDate,
        orderRef: "",
        product,
        productCategory: category,
        mainCategory: category,
        productCode: "",
        quantity: line ? Number(line.quantity) || 0 : 0,
        company: companyName,
        companyCurrency: currency,
        country: "",
        code: "",
        website: "",
        untaxedTotal: -Math.abs(Number(move.amount_untaxed) || 0) * untaxedWeight,
        totalInCurrency: amount,
        usdPaid: lineUsd,
        reportingUsdLocked: false,
        course,
        category,
        partner: m2oName(move.partner_id),
        salesperson: "",
        teamLeader: "",
        salesTeam: "",
        usdSales: lineUsd,
        currency,
        event: "",
        eventStage: "",
        month: invoiceDate.slice(0, 7),
        campaignName: "",
        campaignId: "",
        campaignKey: "",
        adName: "",
        adId: "",
        adset: "",
        adsetOrigin: "none",
        source: "",
        sourceKey: "",
        orderMatched: false,
      });
    }
  }
  return {
    rows: [...snapshot, ...added],
    reconciliation: {
      status: "live",
      documents,
      addedDocuments,
      addedUsd,
      unsupportedCurrencies: [...unsupported],
    },
  };
}

export async function accountingCreditNotes(
  snapshot: AccountingRow[],
  from: string,
  to: string,
  rates: FxRates,
  company = "",
) {
  const { moves, lines } = await cachedPostedCreditNotes(from, to);
  return reconcileCreditNotes(snapshot, moves, lines, rates, odooConfig().url, company);
}
