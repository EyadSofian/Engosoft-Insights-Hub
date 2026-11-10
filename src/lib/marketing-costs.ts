import { normalizePhone } from "./lead-contact-evidence.ts";

export interface WaCostPoint {
  accountId: string;
  date: string;
  phone: string;
  category: string;
  pricingType: string;
  currency: string;
  cost: number;
  volume: number;
}
export interface BroadcastEvent {
  jobId: string;
  messageId: string;
  phone: string;
  acceptedAt: string;
  date: string;
  timeBasis: string;
}
export interface BroadcastJob {
  id: string;
  campaign: string;
  template: string;
  category: string;
  inboxId: string;
  operator: string;
  createdAt: string;
  status: string;
  total: number;
  accepted: number;
  errors: number;
  skipped: number;
  events: BroadcastEvent[];
}
export interface InvoiceFact {
  key: string;
  movement: string;
  company: string;
  invoiceDate: string;
  reportingDate: string;
  source: string;
  revenue: number;
  creditNote: boolean;
  phones: string[];
}
export interface CampaignCostRow {
  campaign: string;
  templates: string[];
  operators: string[];
  jobs: number;
  accepted: number;
  errors: number;
  skipped: number;
  estimatedUsd: number | null;
  assistedInvoices: number;
  assistedRevenue: number;
}

export const phoneIdentity = (phone: string) => normalizePhone(phone).e164 || "";
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const isBroadcastSource = (s: string) =>
  ["whatsappbroadcast", "whtsappbroadcast"].includes(compact(s));
const isOtherWhatsApp = (s: string) => ["whatsapp", "whtsapp", "uchat"].includes(compact(s));

/** Descriptive attribution only. Never adds revenue or estimated costs to the ledger. */
export function analyzeMarketingCosts(
  points: WaCostPoint[],
  jobs: BroadcastJob[],
  invoices: InvoiceFact[],
) {
  const byCategory = new Map<
    string,
    { category: string; currency: string; cost: number; volume: number }
  >();
  const byDay = new Map<string, { date: string; costUsd: number | null; volume: number }>();
  const byPhone = new Map<
    string,
    { accountId: string; phone: string; currency: string; cost: number; volume: number }
  >();
  for (const p of points) {
    const key = `${p.currency}:${p.category}`;
    const row = byCategory.get(key) || {
      category: p.category,
      currency: p.currency,
      cost: 0,
      volume: 0,
    };
    row.cost += p.cost;
    row.volume += p.volume;
    byCategory.set(key, row);
    const day = byDay.get(p.date) || { date: p.date, costUsd: 0, volume: 0 };
    day.costUsd = day.costUsd !== null && p.currency === "USD" ? day.costUsd + p.cost : null;
    day.volume += p.volume;
    byDay.set(p.date, day);
    const pk = `${p.accountId}:${p.phone}`;
    const phone = byPhone.get(pk) || {
      accountId: p.accountId,
      phone: p.phone,
      currency: p.currency,
      cost: 0,
      volume: 0,
    };
    phone.cost += p.cost;
    phone.volume += p.volume;
    byPhone.set(pk, phone);
  }
  const foreignCurrency = points.some((p) => p.currency !== "USD");
  const costUsd = foreignCurrency ? null : points.reduce((s, p) => s + p.cost, 0);
  const byCampaign = new Map<string, CampaignCostRow>();
  const eventsByPhone = new Map<string, { campaign: string; date: string; acceptedAt: string }[]>();
  const seenMessages = new Set<string>();
  let accepted = 0,
    undatedOrUpperBound = 0;
  for (const j of jobs) {
    const c = byCampaign.get(j.campaign) || {
      campaign: j.campaign,
      templates: [],
      operators: [],
      jobs: 0,
      accepted: 0,
      errors: 0,
      skipped: 0,
      estimatedUsd: 0,
      assistedInvoices: 0,
      assistedRevenue: 0,
    };
    c.jobs++;
    c.errors += j.errors;
    c.skipped += j.skipped;
    c.templates = [...new Set([...c.templates, j.template])].filter(Boolean);
    c.operators = [...new Set([...c.operators, j.operator])].filter(Boolean);
    let jobAccepted = 0;
    for (const event of j.events) {
      const id = event.messageId || `${j.id}:${event.phone}:${event.acceptedAt}`;
      if (seenMessages.has(id)) continue;
      seenMessages.add(id);
      accepted++;
      jobAccepted++;
      if (event.timeBasis !== "send_log") undatedOrUpperBound++;
      const phone = phoneIdentity(event.phone);
      if (phone) {
        const rows = eventsByPhone.get(phone) || [];
        rows.push({ campaign: j.campaign, date: event.date, acceptedAt: event.acceptedAt });
        eventsByPhone.set(phone, rows);
      }
    }
    c.accepted += jobAccepted;
    const price = byCategory.get(`USD:${j.category}`);
    c.estimatedUsd =
      c.estimatedUsd !== null && price && price.volume > 0
        ? c.estimatedUsd + (jobAccepted * price.cost) / price.volume
        : null;
    byCampaign.set(j.campaign, c);
  }
  let broadcastRevenue = 0,
    otherWhatsAppRevenue = 0,
    assistedRevenue = 0;
  let broadcastInvoices = 0,
    assistedInvoices = 0,
    sameDay = 0,
    missingPhones = 0;
  const records = [];
  const seenInvoices = new Set<string>();
  for (const invoice of invoices) {
    if (seenInvoices.has(invoice.key)) continue;
    seenInvoices.add(invoice.key);
    const direct = isBroadcastSource(invoice.source);
    if (direct) {
      broadcastRevenue += invoice.revenue;
      if (!invoice.creditNote) broadcastInvoices++;
    }
    if (isOtherWhatsApp(invoice.source)) otherWhatsAppRevenue += invoice.revenue;
    const phones = [...new Set(invoice.phones.map(phoneIdentity).filter(Boolean))];
    if (!phones.length) missingPhones++;
    const candidates = phones.flatMap((p) => eventsByPhone.get(p) || []);
    const before = invoice.invoiceDate
      ? candidates.filter((e) => e.date < invoice.invoiceDate)
      : [];
    const onDay = invoice.invoiceDate
      ? candidates.some((e) => e.date === invoice.invoiceDate)
      : false;
    before.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
    const assigned = !invoice.creditNote ? before[0]?.campaign : undefined;
    if (assigned) {
      const c = byCampaign.get(assigned)!;
      c.assistedInvoices++;
      c.assistedRevenue += invoice.revenue;
      // The assisted extra is disjoint from direct Broadcast revenue.
      if (!direct) {
        assistedInvoices++;
        assistedRevenue += invoice.revenue;
      }
    } else if (onDay && !invoice.creditNote) sameDay++;
    records.push({
      movement: invoice.movement,
      company: invoice.company,
      invoiceDate: invoice.invoiceDate,
      reportingDate: invoice.reportingDate,
      source: invoice.source,
      revenue: invoice.revenue,
      creditNote: invoice.creditNote,
      campaign: assigned || "",
      matchingCampaigns: [...new Set(before.map((e) => e.campaign))],
      match: assigned
        ? "before_invoice_day"
        : onDay
          ? "same_day_unknown_order"
          : !phones.length
            ? "phone_unavailable"
            : "no_match",
    });
  }
  return {
    costUsd,
    foreignCurrency,
    categories: [...byCategory.values()],
    phones: [...byPhone.values()],
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    volume: points.reduce((s, p) => s + p.volume, 0),
    accepted,
    uniqueRecipients: eventsByPhone.size,
    undatedOrUpperBound,
    broadcastRevenue,
    broadcastInvoices,
    otherWhatsAppRevenue,
    assistedRevenue,
    assistedInvoices,
    sameDay,
    missingPhones,
    campaigns: [...byCampaign.values()].sort((a, b) => b.accepted - a.accepted),
    records,
    serviceCostAnomaly: points.some((p) => p.category === "SERVICE" && p.cost > 0),
  };
}

export type MarketingCostAnalysis = ReturnType<typeof analyzeMarketingCosts>;
