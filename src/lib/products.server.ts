// Server-only: product/course sales pulled straight from Odoo.
//
// WHAT THIS ANSWERS
//   "How many of each course did we sell, and where did each sale come from?"
//
// DEFINITIONS (deliberate, and visible in the UI — do not change silently)
//   Population   Confirmed sales orders (`sale.order.state = 'sale'`). A cancelled
//                order or an unconfirmed quotation is not a sale. `basis=invoiced`
//                narrows this to orders whose `invoice_status = 'invoiced'`, which
//                is an order-status diagnostic, not Accounting revenue.
//   Date         `date_order` — when the sale happened. Not the invoice date,
//                which is blank on most rows in this database.
//   Units        Sum of `product_uom_qty` over real product lines. Discount and
//                fee lines are excluded from units but kept in revenue, so the
//                money is net while the count stays a count of courses sold.
//   Revenue      Line `price_total` (tax inclusive, matching every other revenue
//                figure in this dashboard) in the order's own currency.
//   USD          Converted at the Odoo rate **of the order's date**, not today's.
//                EGP moved ~8% against USD across this year; using one rate for
//                the whole period would quietly misstate every comparison.
//   Source       `sale.order.source_id`, falling back to the linked opportunity's
//                source when the order carries none. Never guessed from anything else.
//
// THE THING THIS FILE IS MOST LIKELY TO GET WRONG
//   Three companies bill in three currencies, and the KSA company alone issues
//   orders in SAR, EGP, USD and AED. Adding `price_total` across them produces a
//   number that means nothing. Every native amount is therefore kept bucketed by
//   currency, and only the USD column is ever summed.
import {
  OdooError,
  m2oId,
  m2oName,
  odooConfig,
  odooConfigured,
  searchRead,
  type Domain,
  type M2O,
} from "./odoo.server";
import {
  buildDepartmentMatcher,
  buildFamilyAliases,
  deriveFamily,
  detectVariant,
  normalizeSource,
  UNATTRIBUTED,
} from "./product-taxonomy";

/* --- shapes -------------------------------------------------------------- */

export type SaleBasis = "all" | "invoiced";

export interface ProductFilters {
  from?: string;
  to?: string;
  basis: SaleBasis;
  companyId?: number;
  source?: string;
  variant?: string;
  family?: string;
}

export interface CurrencyAmount {
  currency: string;
  amount: number;
  units: number;
}

export interface Breakdown {
  key: string;
  label: string;
  units: number;
  orders: number;
  revenueUsd: number;
}

export interface ProductRow {
  productId: number;
  /** Exact Odoo product name. Never derived. */
  name: string;
  code: string;
  category: string;
  /** Derived grouping key — a display aid, never a basis for a number. */
  familyKey: string;
  family: string;
  variantKey: string;
  variant: string;
  units: number;
  orders: number;
  revenueUsd: number;
  untaxedUsd: number;
  avgPriceUsd: number | null;
  native: CurrencyAmount[];
  companies: Breakdown[];
  sources: Breakdown[];
  firstSale: string;
  lastSale: string;
  isDiscount: boolean;
}

export interface FamilyRow {
  familyKey: string;
  family: string;
  category: string;
  units: number;
  orders: number;
  revenueUsd: number;
  avgPriceUsd: number | null;
  productCount: number;
  native: CurrencyAmount[];
  variants: Breakdown[];
  sources: Breakdown[];
  products: ProductRow[];
}

export interface ProductsHealth {
  configured: boolean;
  fetchedAt: string;
  /** Rows Odoo returned, before any dashboard filtering. */
  ordersScanned: number;
  linesScanned: number;
  /** Orders with no source on the order and none on the opportunity either. */
  ordersWithoutSource: number;
  /** Lines whose product Odoo would not return (archived beyond read access). */
  linesWithUnknownProduct: number;
  /** Amounts that had to use the oldest available FX rate. */
  linesPricedBeforeRateHistory: number;
  currencies: string[];
  companies: { id: number; name: string; currency: string }[];
  startDate: string;
  /** Newest `date_order` present, used to anchor the date presets. */
  latestOrderDate: string;
  stale: boolean;
  warnings: string[];
}

/* --- FX ------------------------------------------------------------------ */

/**
 * Odoo stores one `res.currency.rate` row per currency per day, expressed
 * against the reading company's base currency. Reading them all under a single
 * company keeps the maths self-consistent: USD per unit of C on date D is
 * `rate(USD, D) / rate(C, D)`.
 */
class RateTable {
  private byCurrency = new Map<string, { date: string; rate: number }[]>();
  earliest = "";

  constructor(rows: { name: string; currency_id: M2O; rate: number }[]) {
    for (const row of rows) {
      const currency = m2oName(row.currency_id);
      if (!currency || !Number.isFinite(row.rate) || row.rate <= 0) continue;
      const list = this.byCurrency.get(currency) ?? [];
      list.push({ date: String(row.name).slice(0, 10), rate: row.rate });
      this.byCurrency.set(currency, list);
    }
    for (const list of this.byCurrency.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    const firsts = [...this.byCurrency.values()].map((l) => l[0]?.date).filter(Boolean) as string[];
    this.earliest = firsts.length ? firsts.sort()[firsts.length - 1] : "";
  }

  private rateOn(currency: string, date: string): { rate: number; extrapolated: boolean } | null {
    const list = this.byCurrency.get(currency);
    if (!list?.length) return null;
    // Latest row on or before `date`; binary search keeps this cheap per line.
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].date <= date) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return { rate: list[0].rate, extrapolated: true };
    return { rate: list[found].rate, extrapolated: false };
  }

  /** USD value of `amount` in `currency` on `date`, or null if unconvertible. */
  toUsd(
    amount: number,
    currency: string,
    date: string,
  ): { usd: number; extrapolated: boolean } | null {
    if (!amount) return { usd: 0, extrapolated: false };
    if (currency === "USD") return { usd: amount, extrapolated: false };
    const usd = this.rateOn("USD", date);
    const cur = this.rateOn(currency, date);
    if (!usd || !cur || !cur.rate) return null;
    return {
      usd: (amount / cur.rate) * usd.rate,
      extrapolated: usd.extrapolated || cur.extrapolated,
    };
  }

  has(currency: string): boolean {
    return currency === "USD" || this.byCurrency.has(currency);
  }
}

/* --- dates --------------------------------------------------------------- */

const CAIRO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Odoo datetimes are naive UTC (`2026-07-27 21:40:11`). The business — and every
 * other tab in this dashboard — reports in Africa/Cairo, so the calendar day has
 * to be resolved there rather than by slicing the UTC string.
 */
/** Shifts a `YYYY-MM-DD` string by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toCairoDate(value: string | false | undefined): string {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : text.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return text.slice(0, 10);
  const parts = CAIRO_DAY.formatToParts(parsed);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/* --- normalized line ----------------------------------------------------- */

interface SaleLine {
  lineId: number;
  orderId: number;
  orderName: string;
  date: string;
  companyId: number;
  company: string;
  currency: string;
  invoiced: boolean;
  qty: number;
  total: number;
  untaxed: number;
  usd: number;
  untaxedUsd: number;
  convertible: boolean;
  productId: number;
  productName: string;
  productCode: string;
  category: string;
  familyKey: string;
  family: string;
  variantKey: string;
  isDiscount: boolean;
  sourceKey: string;
  sourceLabel: string;
  campaign: string;
  medium: string;
  team: string;
  salesperson: string;
  fromWebsite: boolean;
}

export interface ProductSnapshot {
  lines: SaleLine[];
  health: ProductsHealth;
  fetchedAt: number;
}

/* --- fetch + cache ------------------------------------------------------- */

// Short by design. The other tabs read a sheet a cron refreshes every 30 minutes;
// this one is meant to show a sale within a minute of it being confirmed.
const TTL_MS = 60 * 1000;

let cache: ProductSnapshot | null = null;
let inflight: Promise<ProductSnapshot> | null = null;

interface OdooOrder {
  id: number;
  name: string;
  date_order: string;
  invoice_status: string;
  company_id: M2O;
  currency_id: M2O;
  user_id: M2O;
  team_id: M2O;
  opportunity_id: M2O;
  source_id: M2O;
  medium_id: M2O;
  campaign_id: M2O;
  website_id: M2O;
}

interface OdooLine {
  id: number;
  order_id: M2O;
  product_id: M2O;
  product_uom_qty: number;
  price_subtotal: number;
  price_total: number;
  currency_id: M2O;
  company_id: M2O;
  display_type: string | false;
}

interface OdooProduct {
  id: number;
  name: string;
  default_code: string | false;
  categ_id: M2O;
}

async function fetchSnapshot(): Promise<ProductSnapshot> {
  const cfg = odooConfig();
  const warnings: string[] = [];

  // Fetched from one day earlier than the reporting floor: an order placed late
  // on 31 Dec UTC is already 1 Jan in Cairo, and the Cairo date is what counts.
  // Anything still short of the floor after conversion is dropped below.
  const fetchFloor = `${addDays(cfg.startDate, -1)} 00:00:00`;
  const orderDomain: Domain = [
    ["state", "=", "sale"],
    ["date_order", ">=", fetchFloor],
  ];

  const [orders, rawLines, products, categories, rateRows] = await Promise.all([
    searchRead<OdooOrder>("sale.order", orderDomain, [
      "name",
      "date_order",
      "invoice_status",
      "company_id",
      "currency_id",
      "user_id",
      "team_id",
      "opportunity_id",
      "source_id",
      "medium_id",
      "campaign_id",
      "website_id",
    ]),
    searchRead<OdooLine>(
      "sale.order.line",
      [
        ["order_id.state", "=", "sale"],
        ["order_id.date_order", ">=", `${cfg.startDate} 00:00:00`],
      ],
      [
        "order_id",
        "product_id",
        "product_uom_qty",
        "price_subtotal",
        "price_total",
        "currency_id",
        "company_id",
        "display_type",
      ],
    ),
    searchRead<OdooProduct>("product.product", [], ["name", "default_code", "categ_id"], {
      context: { active_test: false },
    }),
    searchRead<{ id: number; complete_name: string }>("product.category", [], ["complete_name"]),
    searchRead<{ id: number; name: string; currency_id: M2O; rate: number }>(
      "res.currency.rate",
      [["company_id", "=", cfg.companyIds[0]]],
      ["name", "currency_id", "rate"],
      { order: "name asc" },
    ),
  ]);

  const rates = new RateTable(rateRows);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const productById = new Map(products.map((p) => [p.id, p]));

  // Odoo stores `date_order` in UTC. Every other tab reports Cairo dates (the
  // n8n sync converts before writing the sheet), and 3.4% of orders fall on a
  // different day in the two zones — enough to move revenue across a month
  // boundary and make this tab disagree with the rest of the dashboard.
  // Computed once per order, not per line: Intl formatting is not free.
  const cairoDate = new Map<number, string>();
  for (const order of orders) cairoDate.set(order.id, toCairoDate(order.date_order));

  // Orders with no UTM source of their own borrow the linked opportunity's.
  const needLead = orders.filter((o) => !m2oId(o.source_id) && m2oId(o.opportunity_id));
  const leadSource = new Map<number, string>();
  if (needLead.length) {
    const leads = await searchRead<{ id: number; source_id: M2O }>(
      "crm.lead",
      [["id", "in", needLead.map((o) => m2oId(o.opportunity_id))]],
      ["source_id"],
      { context: { active_test: false } },
    );
    for (const lead of leads) {
      const name = m2oName(lead.source_id);
      if (name) leadSource.set(lead.id, name);
    }
  }

  const department = buildDepartmentMatcher(categories.map((c) => c.complete_name));

  // Pass 1: derive each product's family/variant once.
  interface Derived {
    family: { key: string; label: string };
    variantKey: string;
    category: string;
    isDiscount: boolean;
  }
  const derived = new Map<number, Derived>();
  for (const product of products) {
    const category = m2oName(product.categ_id);
    const variantKey = detectVariant(product.name, category);
    derived.set(product.id, {
      family: deriveFamily(product.name, department, variantKey),
      variantKey,
      category,
      isDiscount: variantKey === "discount",
    });
  }
  const aliases = buildFamilyAliases([...derived.values()].map((d) => d.family));
  const familyLabel = new Map<string, string>();
  for (const d of derived.values()) {
    const key = aliases.get(d.family.key) ?? d.family.key;
    const current = familyLabel.get(key);
    // The shortest spelling of a family reads best as its heading.
    if (!current || d.family.label.length < current.length) familyLabel.set(key, d.family.label);
  }

  // Pass 2: normalize the lines.
  const lines: SaleLine[] = [];
  let unknownProduct = 0;
  let extrapolated = 0;
  let noSource = 0;
  const unconvertible = new Set<string>();
  const currencies = new Set<string>();
  const companies = new Map<number, { id: number; name: string; currency: string }>();
  let latestOrderDate = "";

  const seenOrderNoSource = new Set<number>();

  for (const raw of rawLines) {
    if (raw.display_type) continue;
    const productId = m2oId(raw.product_id);
    if (!productId) continue;

    const order = orderById.get(m2oId(raw.order_id));
    if (!order) continue;

    const product = productById.get(productId);
    if (!product) unknownProduct++;

    const date = cairoDate.get(order.id) ?? "";
    // The extra day pulled in for the timezone shift is only useful if it lands
    // inside the reporting period once converted.
    if (!date || date < cfg.startDate) continue;
    if (date > latestOrderDate) latestOrderDate = date;

    const currency = m2oName(raw.currency_id) || m2oName(order.currency_id);
    const companyId = m2oId(raw.company_id) || m2oId(order.company_id);
    const companyName = m2oName(raw.company_id) || m2oName(order.company_id);
    currencies.add(currency);
    if (companyId && !companies.has(companyId)) {
      companies.set(companyId, {
        id: companyId,
        name: companyName,
        currency: m2oName(order.currency_id),
      });
    }

    const total = Number(raw.price_total ?? 0);
    const untaxed = Number(raw.price_subtotal ?? 0);
    const converted = rates.toUsd(total, currency, date);
    const convertedUntaxed = rates.toUsd(untaxed, currency, date);
    if (!converted) unconvertible.add(currency);
    if (converted?.extrapolated) extrapolated++;

    const info = derived.get(productId);
    const familyKey = info
      ? (aliases.get(info.family.key) ?? info.family.key)
      : `product:${productId}`;
    const productName = product?.name ?? m2oName(raw.product_id) ?? `#${productId}`;

    const rawSource = m2oName(order.source_id) || leadSource.get(m2oId(order.opportunity_id)) || "";
    const source = normalizeSource(rawSource);
    if (source.key === UNATTRIBUTED && !seenOrderNoSource.has(order.id)) {
      seenOrderNoSource.add(order.id);
      noSource++;
    }

    lines.push({
      lineId: raw.id,
      orderId: order.id,
      orderName: order.name || "",
      date,
      companyId,
      company: companyName,
      currency,
      invoiced: order.invoice_status === "invoiced",
      qty: Number(raw.product_uom_qty ?? 0),
      total,
      untaxed,
      usd: converted?.usd ?? 0,
      untaxedUsd: convertedUntaxed?.usd ?? 0,
      convertible: Boolean(converted),
      productId,
      productName,
      productCode: (product?.default_code || "") as string,
      category: info?.category ?? "",
      familyKey,
      family: familyLabel.get(familyKey) ?? productName,
      variantKey: info?.variantKey ?? "standard",
      isDiscount: info?.isDiscount ?? false,
      sourceKey: source.key,
      sourceLabel: source.label,
      campaign: m2oName(order.campaign_id),
      medium: m2oName(order.medium_id),
      team: m2oName(order.team_id),
      salesperson: m2oName(order.user_id),
      fromWebsite: Boolean(m2oId(order.website_id)),
    });
  }

  if (unknownProduct)
    warnings.push(`${unknownProduct} order lines reference a product this account cannot read.`);
  if (unconvertible.size) {
    warnings.push(
      `No exchange-rate history for ${[...unconvertible].join(", ")} — those amounts are excluded from USD totals.`,
    );
  }
  if (extrapolated) {
    warnings.push(
      `${extrapolated} lines predate the oldest FX rate and use the earliest available rate.`,
    );
  }

  return {
    lines,
    fetchedAt: Date.now(),
    health: {
      configured: true,
      fetchedAt: new Date().toISOString(),
      ordersScanned: orders.length,
      linesScanned: rawLines.length,
      ordersWithoutSource: noSource,
      linesWithUnknownProduct: unknownProduct,
      linesPricedBeforeRateHistory: extrapolated,
      currencies: [...currencies].filter(Boolean).sort(),
      companies: [...companies.values()].sort((a, b) => a.id - b.id),
      startDate: cfg.startDate,
      latestOrderDate,
      stale: false,
      warnings,
    },
  };
}

/**
 * Returns the cached snapshot, refreshing it when older than the TTL. A failed
 * refresh keeps serving the previous snapshot flagged `stale` rather than
 * blanking the page — the same contract the sheet cache uses.
 */
export async function getProductSnapshot(force = false): Promise<ProductSnapshot> {
  if (!odooConfigured()) {
    throw new OdooError(
      "Odoo is not configured. Set ODOO_LOGIN and ODOO_API_KEY in the environment.",
      "config",
    );
  }
  if (!force && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    try {
      cache = await fetchSnapshot();
      return cache;
    } catch (err) {
      if (cache) {
        return { ...cache, health: { ...cache.health, stale: true } };
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/* --- aggregation --------------------------------------------------------- */

const inWindow = (date: string, from?: string, to?: string): boolean => {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

function selectLines(snapshot: ProductSnapshot, f: ProductFilters): SaleLine[] {
  return snapshot.lines.filter((l) => {
    if (!inWindow(l.date, f.from, f.to)) return false;
    if (f.basis === "invoiced" && !l.invoiced) return false;
    if (f.companyId && l.companyId !== f.companyId) return false;
    if (f.source && l.sourceKey !== f.source) return false;
    if (f.variant && l.variantKey !== f.variant) return false;
    if (f.family && l.familyKey !== f.family) return false;
    return true;
  });
}

export interface WebsiteCampaignSale {
  campaign: string;
  orders: number;
  units: number;
  revenueUsd: number;
}

/**
 * Confirmed website orders grouped by Odoo's standard UTM Campaign field.
 * This is intentionally exact: a blank or differently-spelled campaign stays
 * unlinked instead of being guessed into an ad campaign.
 */
export function websiteCampaignSales(snapshot: ProductSnapshot, f: ProductFilters) {
  const websiteLines = selectLines(snapshot, f).filter((line) => line.fromWebsite);
  const byCampaign = new Map<
    string,
    { campaign: string; orders: Set<number>; units: number; revenueUsd: number }
  >();
  const allOrders = new Set<number>();
  const attributedOrders = new Set<number>();
  let totalRevenue = 0;
  let attributedRevenue = 0;

  for (const line of websiteLines) {
    allOrders.add(line.orderId);
    if (line.convertible) totalRevenue += line.usd;
    const campaign = line.campaign.trim();
    if (!campaign) continue;
    attributedOrders.add(line.orderId);
    let row = byCampaign.get(campaign);
    if (!row) {
      row = { campaign, orders: new Set(), units: 0, revenueUsd: 0 };
      byCampaign.set(campaign, row);
    }
    row.orders.add(line.orderId);
    if (countsAsUnit(line)) row.units += line.qty;
    if (line.convertible) {
      row.revenueUsd += line.usd;
      attributedRevenue += line.usd;
    }
  }

  const rows: WebsiteCampaignSale[] = [...byCampaign.values()]
    .map((row) => ({
      campaign: row.campaign,
      orders: row.orders.size,
      units: row.units,
      revenueUsd: row.revenueUsd,
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.orders - a.orders);

  return {
    rows,
    totals: {
      websiteOrders: allOrders.size,
      attributedOrders: attributedOrders.size,
      unattributedOrders: allOrders.size - attributedOrders.size,
      websiteRevenue: totalRevenue,
      attributedRevenue,
      unattributedRevenue: totalRevenue - attributedRevenue,
    },
  };
}

/** Units count courses, so discount and fee lines are excluded from them. */
const countsAsUnit = (l: SaleLine) => !l.isDiscount && l.variantKey !== "fee";

class Bucket {
  units = 0;
  revenueUsd = 0;
  untaxedUsd = 0;
  orders = new Set<number>();
  native = new Map<string, { amount: number; units: number }>();

  add(l: SaleLine) {
    const unit = countsAsUnit(l) ? l.qty : 0;
    this.units += unit;
    if (l.convertible) {
      this.revenueUsd += l.usd;
      this.untaxedUsd += l.untaxedUsd;
    }
    this.orders.add(l.orderId);
    const n = this.native.get(l.currency) ?? { amount: 0, units: 0 };
    n.amount += l.total;
    n.units += unit;
    this.native.set(l.currency, n);
  }

  nativeList(): CurrencyAmount[] {
    return [...this.native.entries()]
      .map(([currency, v]) => ({ currency, amount: v.amount, units: v.units }))
      .sort((a, b) => b.amount - a.amount);
  }
}

function breakdown(
  lines: SaleLine[],
  keyOf: (l: SaleLine) => string,
  labelOf: (l: SaleLine) => string,
): Breakdown[] {
  const map = new Map<string, { label: string; bucket: Bucket }>();
  for (const l of lines) {
    const key = keyOf(l);
    let entry = map.get(key);
    if (!entry) {
      entry = { label: labelOf(l), bucket: new Bucket() };
      map.set(key, entry);
    }
    entry.bucket.add(l);
  }
  return [...map.entries()]
    .map(([key, { label, bucket }]) => ({
      key,
      label,
      units: bucket.units,
      orders: bucket.orders.size,
      revenueUsd: bucket.revenueUsd,
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.units - a.units);
}

export interface ProductsResult {
  families: FamilyRow[];
  products: ProductRow[];
  sources: Breakdown[];
  variants: Breakdown[];
  companies: Breakdown[];
  campaigns: Breakdown[];
  monthly: { month: string; units: number; revenueUsd: number }[];
  totals: {
    units: number;
    orders: number;
    revenueUsd: number;
    untaxedUsd: number;
    products: number;
    families: number;
    native: CurrencyAmount[];
    /** Confirmed-but-not-yet-invoiced share, so the basis toggle is never a surprise. */
    invoicedUnits: number;
    invoicedRevenueUsd: number;
  };
  health: ProductsHealth;
}

export function computeProducts(snapshot: ProductSnapshot, f: ProductFilters): ProductsResult {
  const lines = selectLines(snapshot, f);

  const byProduct = new Map<number, { lines: SaleLine[]; bucket: Bucket }>();
  const byFamily = new Map<number | string, { lines: SaleLine[]; bucket: Bucket }>();
  const totals = new Bucket();
  const monthly = new Map<string, { units: number; revenueUsd: number }>();
  let invoicedUnits = 0;
  let invoicedRevenueUsd = 0;

  for (const l of lines) {
    totals.add(l);

    let p = byProduct.get(l.productId);
    if (!p) {
      p = { lines: [], bucket: new Bucket() };
      byProduct.set(l.productId, p);
    }
    p.lines.push(l);
    p.bucket.add(l);

    let fam = byFamily.get(l.familyKey);
    if (!fam) {
      fam = { lines: [], bucket: new Bucket() };
      byFamily.set(l.familyKey, fam);
    }
    fam.lines.push(l);
    fam.bucket.add(l);

    const month = l.date.slice(0, 7);
    const m = monthly.get(month) ?? { units: 0, revenueUsd: 0 };
    if (countsAsUnit(l)) m.units += l.qty;
    if (l.convertible) m.revenueUsd += l.usd;
    monthly.set(month, m);

    if (l.invoiced) {
      if (countsAsUnit(l)) invoicedUnits += l.qty;
      if (l.convertible) invoicedRevenueUsd += l.usd;
    }
  }

  const productRows: ProductRow[] = [...byProduct.entries()].map(
    ([productId, { lines: rows, bucket }]) => {
      const head = rows[0];
      const dates = rows
        .map((r) => r.date)
        .filter(Boolean)
        .sort();
      return {
        productId,
        name: head.productName,
        code: head.productCode,
        category: head.category,
        familyKey: head.familyKey,
        family: head.family,
        variantKey: head.variantKey,
        variant: head.variantKey,
        units: bucket.units,
        orders: bucket.orders.size,
        revenueUsd: bucket.revenueUsd,
        untaxedUsd: bucket.untaxedUsd,
        avgPriceUsd: bucket.units > 0 ? bucket.revenueUsd / bucket.units : null,
        native: bucket.nativeList(),
        companies: breakdown(
          rows,
          (l) => String(l.companyId),
          (l) => l.company,
        ),
        sources: breakdown(
          rows,
          (l) => l.sourceKey,
          (l) => l.sourceLabel,
        ),
        firstSale: dates[0] ?? "",
        lastSale: dates[dates.length - 1] ?? "",
        isDiscount: head.isDiscount,
      };
    },
  );

  const productsByFamily = new Map<string, ProductRow[]>();
  for (const row of productRows) {
    const list = productsByFamily.get(row.familyKey) ?? [];
    list.push(row);
    productsByFamily.set(row.familyKey, list);
  }

  const familyRows: FamilyRow[] = [...byFamily.entries()].map(([key, { lines: rows, bucket }]) => {
    const members = (productsByFamily.get(String(key)) ?? []).sort(
      (a, b) => b.revenueUsd - a.revenueUsd,
    );
    // A family can straddle categories; report the one carrying the most money.
    const categoryTotals = new Map<string, number>();
    for (const l of rows)
      categoryTotals.set(
        l.category,
        (categoryTotals.get(l.category) ?? 0) + (l.convertible ? l.usd : 0),
      );
    const category = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return {
      familyKey: String(key),
      family: rows[0].family,
      category,
      units: bucket.units,
      orders: bucket.orders.size,
      revenueUsd: bucket.revenueUsd,
      avgPriceUsd: bucket.units > 0 ? bucket.revenueUsd / bucket.units : null,
      productCount: members.length,
      native: bucket.nativeList(),
      variants: breakdown(
        rows,
        (l) => l.variantKey,
        (l) => l.variantKey,
      ),
      sources: breakdown(
        rows,
        (l) => l.sourceKey,
        (l) => l.sourceLabel,
      ),
      products: members,
    };
  });

  return {
    families: familyRows.sort((a, b) => b.revenueUsd - a.revenueUsd),
    products: productRows.sort((a, b) => b.revenueUsd - a.revenueUsd),
    sources: breakdown(
      lines,
      (l) => l.sourceKey,
      (l) => l.sourceLabel,
    ),
    variants: breakdown(
      lines,
      (l) => l.variantKey,
      (l) => l.variantKey,
    ),
    companies: breakdown(
      lines,
      (l) => String(l.companyId),
      (l) => l.company,
    ),
    campaigns: breakdown(
      lines.filter((l) => l.campaign),
      (l) => l.campaign,
      (l) => l.campaign,
    ).slice(0, 50),
    monthly: [...monthly.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    totals: {
      units: totals.units,
      orders: totals.orders.size,
      revenueUsd: totals.revenueUsd,
      untaxedUsd: totals.untaxedUsd,
      products: productRows.length,
      families: familyRows.length,
      native: totals.nativeList(),
      invoicedUnits,
      invoicedRevenueUsd,
    },
    health: snapshot.health,
  };
}

/** Every line behind one product, for the drill-down drawer. */
export function productDetail(snapshot: ProductSnapshot, f: ProductFilters, productId: number) {
  const rows = selectLines(snapshot, f).filter((l) => l.productId === productId);
  if (!rows.length) return null;

  const monthly = new Map<string, { units: number; revenueUsd: number }>();
  for (const l of rows) {
    const m = monthly.get(l.date.slice(0, 7)) ?? { units: 0, revenueUsd: 0 };
    if (countsAsUnit(l)) m.units += l.qty;
    if (l.convertible) m.revenueUsd += l.usd;
    monthly.set(l.date.slice(0, 7), m);
  }

  return {
    productId,
    name: rows[0].productName,
    sources: breakdown(
      rows,
      (l) => l.sourceKey,
      (l) => l.sourceLabel,
    ),
    campaigns: breakdown(
      rows.filter((l) => l.campaign),
      (l) => l.campaign,
      (l) => l.campaign,
    ).slice(0, 12),
    salespeople: breakdown(
      rows.filter((l) => l.salesperson),
      (l) => l.salesperson,
      (l) => l.salesperson,
    ).slice(0, 12),
    teams: breakdown(
      rows.filter((l) => l.team),
      (l) => l.team,
      (l) => l.team,
    ).slice(0, 12),
    companies: breakdown(
      rows,
      (l) => String(l.companyId),
      (l) => l.company,
    ),
    monthly: [...monthly.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    orders: rows
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 200)
      .map((l) => ({
        orderName: l.orderName,
        date: l.date,
        company: l.company,
        currency: l.currency,
        qty: l.qty,
        total: l.total,
        usd: l.convertible ? l.usd : null,
        source: l.sourceLabel,
        sourceKey: l.sourceKey,
        campaign: l.campaign,
        salesperson: l.salesperson,
        invoiced: l.invoiced,
      })),
  };
}

export type ProductDetail = NonNullable<ReturnType<typeof productDetail>>;
