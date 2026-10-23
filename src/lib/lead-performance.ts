import { excludedLeadSource } from "./lead-count-policy";
import { normalizePhone, phoneMatchKey, samePhoneIdentity } from "./lead-contact-evidence";
import { canonicalLossReason } from "./loss-reason-taxonomy";
import { mediaBuyerForCampaign, MEDIA_BUYERS } from "./media-buyers";

export interface PerformanceLead {
  id: string;
  createdAt: string;
  createdAtUtc?: string;
  recordType: "lead" | "opportunity";
  status: "lead" | "open" | "won" | "lost";
  source: string;
  leadSegment: string;
  course: string;
  campaign: string;
  salesperson: string;
  phone: string;
  mobile: string;
  email: string;
  lossReason: string;
}

export interface PerformanceInvoice {
  orderRef: string;
  date: string;
  usdPaid: number;
  salesperson: string;
}

export interface PerformanceCall {
  phone: string;
  day: string;
  totalCalls: number;
  firstCallAt?: string;
}

export interface PerformanceQa {
  id: string;
  verdict: "valid" | "invalid" | "unclear" | "";
  reason: string;
}

export interface PerformanceGroup {
  name: string;
  leads: number;
  duplicateSameMonth: number;
  duplicateEarlierMonth: number;
  confirmedDuplicate: number;
  unqualified: number;
  noAnswer: number;
  unreachable: number;
  noInterest: number;
  lost: number;
  opportunities: number;
  crmWon: number;
  paidLeads: number;
  paidOrders: number;
  paidLater: number;
  paidRevenue: number;
  conversionRate: number | null;
  lostRate: number | null;
  contact0: number | null;
  contact1: number | null;
  contact2: number | null;
  contact3Plus: number | null;
  averageAttempts: number | null;
  averageDaysToFirstCall: number | null;
  averageHoursToFirstCall: number | null;
  exactLagSample: number | null;
  callMatchable: number | null;
}

export interface PerformanceResult {
  asOf: string;
  months: string[];
  selectedMonth: string;
  rows: PerformanceGroup[];
  selected: PerformanceGroup;
  byCourse: PerformanceGroup[];
  bySource: PerformanceGroup[];
  byCampaign: PerformanceGroup[];
  byMediaBuyer: PerformanceGroup[];
  bySalesOwner: PerformanceGroup[];
  bySalesCloser: PerformanceGroup[];
  lossReasons: { key: string; ar: string; en: string; count: number }[];
  unqualifiedReasons: { category: "customer_data" | "course_fit" | "unspecified"; count: number }[];
  coverage: {
    excludedRecommendation: number;
    excludedBroadcast: number;
    missingIdentity: number;
    unknownCampaign: number;
    unknownMediaBuyer: number;
    qaReviewed: number;
    ambiguousOrders: number;
    unlinkedAccountingLines: number;
    linkedAccountingLines: number;
    callsAvailable: boolean;
    qaAvailable: boolean;
    linksAvailable: boolean;
  };
}

export function sixCalendarMonths(asOf: string): string[] {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  if (!year || month < 1 || month > 12) return [];
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 6 + i, 1));
    return date.toISOString().slice(0, 7);
  });
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const rate = (part: number, whole: number) => (whole ? round2((part / whole) * 100) : null);
const dateOnly = (value: string) => value.slice(0, 10);
const monthOf = (value: string) => value.slice(0, 7);
const DAY_MS = 86_400_000;

function identityKeys(lead: PerformanceLead): string[] {
  const keys = [lead.phone, lead.mobile]
    .map(normalizePhone)
    .map((phone) =>
      phone.e164 ? `p:${phone.e164}` : phone.digits.length >= 10 ? `p?:${phone.digits}` : "",
    )
    .filter(Boolean);
  const email = lead.email.trim().toLocaleLowerCase("en");
  if (email && email.includes("@")) keys.push(`e:${email}`);
  return [...new Set(keys)];
}

function unqualifiedCategory(reason: string): "customer_data" | "course_fit" | "unspecified" {
  const value = reason.toLocaleLowerCase("en");
  if (/number|phone|email|بيانات|رقم|هاتف|ايميل/.test(value)) return "customer_data";
  if (/course|special|fit|تخصص|كورس|دورة|غير مناسب/.test(value)) return "course_fit";
  return "unspecified";
}

type Enriched = PerformanceLead & {
  duplicate: "same" | "earlier" | null;
  reason: ReturnType<typeof canonicalLossReason>;
  unqualifiedCategory: ReturnType<typeof unqualifiedCategory> | null;
  paidOrders: Set<string>;
  paidRevenue: number;
  paidLater: boolean;
  closer: string;
  calls: number | null;
  firstCallLagDays: number | null;
  firstCallLagHours: number | null;
};

function aggregate(name: string, records: Enriched[], callsAvailable: boolean): PerformanceGroup {
  const paidLeads = records.filter((row) => row.paidOrders.size > 0).length;
  const matched = records.filter((row) => row.calls !== null);
  const lags = records
    .map((row) => row.firstCallLagDays)
    .filter((lag): lag is number => lag !== null);
  const exactLags = records
    .map((row) => row.firstCallLagHours)
    .filter((lag): lag is number => lag !== null);
  return {
    name,
    leads: records.length,
    duplicateSameMonth: records.filter((row) => row.duplicate === "same").length,
    duplicateEarlierMonth: records.filter((row) => row.duplicate === "earlier").length,
    confirmedDuplicate: records.filter(
      (row) => row.status === "lost" && row.reason.canonicalReasonKey === "duplicate",
    ).length,
    unqualified: records.filter((row) => row.unqualifiedCategory !== null).length,
    noAnswer: records.filter(
      (row) => row.status === "lost" && row.reason.canonicalReasonKey === "not_reached",
    ).length,
    unreachable: records.filter(
      (row) =>
        row.status === "lost" &&
        ["unreachable_number", "wrong_number"].includes(row.reason.canonicalReasonKey),
    ).length,
    noInterest: records.filter(
      (row) => row.status === "lost" && row.reason.canonicalReasonKey === "not_interested",
    ).length,
    lost: records.filter((row) => row.status === "lost").length,
    opportunities: records.filter((row) => row.recordType === "opportunity").length,
    crmWon: records.filter((row) => row.status === "won").length,
    paidLeads,
    paidOrders: new Set(records.flatMap((row) => [...row.paidOrders])).size,
    paidLater: records.filter((row) => row.paidLater).length,
    paidRevenue: round2(records.reduce((sum, row) => sum + row.paidRevenue, 0)),
    conversionRate: rate(paidLeads, records.length),
    lostRate: rate(records.filter((row) => row.status === "lost").length, records.length),
    contact0: callsAvailable ? matched.filter((row) => row.calls === 0).length : null,
    contact1: callsAvailable ? matched.filter((row) => row.calls === 1).length : null,
    contact2: callsAvailable ? matched.filter((row) => row.calls === 2).length : null,
    contact3Plus: callsAvailable ? matched.filter((row) => (row.calls ?? 0) >= 3).length : null,
    averageAttempts:
      callsAvailable && matched.length
        ? round2(matched.reduce((sum, row) => sum + (row.calls ?? 0), 0) / matched.length)
        : null,
    averageDaysToFirstCall:
      callsAvailable && lags.length
        ? round2(lags.reduce((sum, lag) => sum + lag, 0) / lags.length)
        : null,
    averageHoursToFirstCall:
      callsAvailable && exactLags.length
        ? round2(exactLags.reduce((sum, lag) => sum + lag, 0) / exactLags.length)
        : null,
    exactLagSample: callsAvailable ? exactLags.length : null,
    callMatchable: callsAvailable ? matched.length : null,
  };
}

function groups(records: Enriched[], key: (row: Enriched) => string, callsAvailable: boolean) {
  const map = new Map<string, Enriched[]>();
  for (const row of records) {
    const name = key(row).trim() || "—";
    const list = map.get(name) ?? [];
    list.push(row);
    map.set(name, list);
  }
  return [...map]
    .map(([name, rows]) => aggregate(name, rows, callsAvailable))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
}

export function buildLeadPerformance(input: {
  leads: readonly PerformanceLead[];
  invoices: readonly PerformanceInvoice[];
  links: readonly { orderName: string; opportunityId: string }[];
  calls: readonly PerformanceCall[] | null;
  qa: readonly PerformanceQa[] | null;
  asOf: string;
  selectedMonth?: string;
  course?: string;
  linksAvailable: boolean;
}): PerformanceResult {
  const months = sixCalendarMonths(input.asOf);
  const selectedMonth = months.includes(input.selectedMonth ?? "")
    ? input.selectedMonth!
    : months.at(-1)!;
  const coverage = {
    excludedRecommendation: 0,
    excludedBroadcast: 0,
    missingIdentity: 0,
    unknownCampaign: 0,
    unknownMediaBuyer: 0,
    qaReviewed: 0,
    ambiguousOrders: 0,
    unlinkedAccountingLines: 0,
    linkedAccountingLines: 0,
    callsAvailable: input.calls !== null,
    qaAvailable: input.qa !== null,
    linksAvailable: input.linksAvailable,
  };

  const eligible = new Map<string, PerformanceLead>();
  for (const lead of input.leads) {
    if (
      !lead.id ||
      !lead.createdAt ||
      dateOnly(lead.createdAt) > input.asOf ||
      eligible.has(lead.id)
    )
      continue;
    const excluded = excludedLeadSource(lead.source, lead.leadSegment);
    if (excluded) {
      if (
        monthOf(lead.createdAt) === selectedMonth &&
        (!input.course || lead.course === input.course)
      ) {
        if (excluded === "whatsapp_broadcast") coverage.excludedBroadcast++;
        else coverage.excludedRecommendation++;
      }
      continue;
    }
    eligible.set(lead.id, lead);
  }

  const qaById = new Map((input.qa ?? []).map((row) => [row.id, row]));
  const firstByIdentity = new Map<string, string>();
  const sorted = [...eligible.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const enriched = new Map<string, Enriched>();
  const phoneOwners = new Map<string, Set<string>>();
  for (const lead of sorted) {
    const keys = identityKeys(lead);
    if (!keys.length) coverage.missingIdentity++;
    const earlier = keys
      .map((key) => firstByIdentity.get(key))
      .filter((value): value is string => Boolean(value));
    const earliest = earlier.sort()[0];
    const duplicate = earliest
      ? monthOf(earliest) === monthOf(lead.createdAt)
        ? "same"
        : "earlier"
      : null;
    for (const key of keys) if (!firstByIdentity.has(key)) firstByIdentity.set(key, lead.createdAt);
    for (const key of [...new Set([lead.phone, lead.mobile].map(phoneMatchKey).filter(Boolean))]) {
      const owners = phoneOwners.get(key) ?? new Set<string>();
      owners.add(lead.id);
      phoneOwners.set(key, owners);
    }
    const reason = canonicalLossReason(lead.lossReason);
    const qa = qaById.get(lead.id);
    const unqualified =
      (lead.status === "lost" && reason.canonicalReasonKey === "not_qualified") ||
      qa?.verdict === "invalid";
    enriched.set(lead.id, {
      ...lead,
      duplicate,
      reason,
      unqualifiedCategory: unqualified ? unqualifiedCategory(qa?.reason || lead.lossReason) : null,
      paidOrders: new Set(),
      paidRevenue: 0,
      paidLater: false,
      closer: "",
      calls: null,
      firstCallLagDays: null,
      firstCallLagHours: null,
    });
  }

  const orderToLead = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const link of input.links) {
    const order = link.orderName.trim();
    if (!order || !link.opportunityId) continue;
    const prior = orderToLead.get(order);
    if (prior && prior !== link.opportunityId) ambiguous.add(order);
    else orderToLead.set(order, link.opportunityId);
  }
  for (const order of ambiguous) orderToLead.delete(order);
  coverage.ambiguousOrders = ambiguous.size;
  const orderLines = new Map<string, PerformanceInvoice[]>();
  for (const line of input.invoices) {
    if (!line.date || line.date > input.asOf) continue;
    const order = line.orderRef.trim();
    if (!order) {
      coverage.unlinkedAccountingLines++;
      continue;
    }
    if (orderToLead.has(order)) coverage.linkedAccountingLines++;
    else coverage.unlinkedAccountingLines++;
    const list = orderLines.get(order) ?? [];
    list.push(line);
    orderLines.set(order, list);
  }
  for (const [order, lines] of orderLines) {
    const lead = enriched.get(orderToLead.get(order) ?? "");
    if (!lead) continue;
    const net = lines.reduce((sum, line) => sum + line.usdPaid, 0);
    // Fully refunded orders are not paid registrations. Keep signed financial net.
    lead.paidRevenue += net;
    if (net <= 0) continue;
    lead.paidOrders.add(order);
    const firstPaid = lines
      .filter((line) => line.usdPaid > 0)
      .map((line) => line.date)
      .sort()[0];
    if (firstPaid && monthOf(firstPaid) > monthOf(lead.createdAt)) lead.paidLater = true;
    const closers = [
      ...new Set(
        lines
          .filter((line) => line.usdPaid > 0)
          .map((line) => line.salesperson.trim())
          .filter(Boolean),
      ),
    ];
    if (closers.length === 1) lead.closer = closers[0]!;
  }

  if (input.calls !== null) {
    const callMap = new Map<string, PerformanceCall[]>();
    for (const call of input.calls) {
      const phone = normalizePhone(call.phone);
      if (!phone.key || !call.day || call.day > input.asOf) continue;
      const key = phone.key;
      const list = callMap.get(key) ?? [];
      list.push(call);
      callMap.set(key, list);
    }
    for (const lead of enriched.values()) {
      const phones = [...new Set([lead.phone, lead.mobile].map(phoneMatchKey).filter(Boolean))];
      if (!phones.length || phones.some((key) => (phoneOwners.get(key)?.size ?? 0) !== 1)) continue;
      const leadPhones = [lead.phone, lead.mobile].filter(Boolean).map(normalizePhone);
      const calls = [...new Set(phones.flatMap((key) => callMap.get(key) ?? []))].filter(
        (call) =>
          call.day >= dateOnly(lead.createdAt) &&
          leadPhones.some((phone) => samePhoneIdentity(phone, normalizePhone(call.phone))),
      );
      lead.calls = calls.reduce((sum, call) => sum + Math.max(0, call.totalCalls), 0);
      const first = calls.map((call) => call.day).sort()[0];
      if (first) {
        const lag =
          (Date.parse(`${first}T00:00:00Z`) - Date.parse(`${dateOnly(lead.createdAt)}T00:00:00Z`)) /
          DAY_MS;
        if (Number.isFinite(lag) && lag >= 0) lead.firstCallLagDays = lag;
      }
      const firstInstant = calls
        .map((call) => call.firstCallAt ?? "")
        .filter(Boolean)
        .sort()[0];
      const createdInstant = lead.createdAtUtc
        ? Date.parse(`${lead.createdAtUtc.replace(" ", "T")}Z`)
        : NaN;
      const calledInstant = firstInstant
        ? Date.parse(
            firstInstant.includes("T") ? firstInstant : `${firstInstant.replace(" ", "T")}Z`,
          )
        : NaN;
      if (Number.isFinite(createdInstant) && Number.isFinite(calledInstant)) {
        const hours = (calledInstant - createdInstant) / 3_600_000;
        if (hours >= 0) lead.firstCallLagHours = hours;
      }
    }
  }

  const scoped = [...enriched.values()]
    .filter((row) => months.includes(monthOf(row.createdAt)))
    .filter((row) => !input.course || row.course === input.course);
  const rows = months.map((month) =>
    aggregate(
      month,
      scoped.filter((row) => monthOf(row.createdAt) === month),
      coverage.callsAvailable,
    ),
  );
  const selectedRecords = scoped.filter((row) => monthOf(row.createdAt) === selectedMonth);
  coverage.qaReviewed = selectedRecords.filter((row) => {
    const verdict = qaById.get(row.id)?.verdict;
    return verdict === "valid" || verdict === "invalid";
  }).length;
  coverage.unknownCampaign = selectedRecords.filter((row) => !row.campaign.trim()).length;
  coverage.unknownMediaBuyer = selectedRecords.filter((row) => {
    const buyer = row.campaign.trim() ? mediaBuyerForCampaign(row.course, row.campaign) : null;
    return buyer === null || buyer === "ambiguous";
  }).length;
  const reasonMap = new Map<string, { key: string; ar: string; en: string; count: number }>();
  for (const row of selectedRecords.filter((lead) => lead.status === "lost")) {
    const reason = row.reason;
    const value = reasonMap.get(reason.canonicalReasonKey) ?? {
      key: reason.canonicalReasonKey,
      ar: reason.canonicalReasonLabelAr,
      en: reason.canonicalReasonLabelEn,
      count: 0,
    };
    value.count++;
    reasonMap.set(value.key, value);
  }
  return {
    asOf: input.asOf,
    months,
    selectedMonth,
    rows,
    selected: aggregate(selectedMonth, selectedRecords, coverage.callsAvailable),
    byCourse: groups(selectedRecords, (row) => row.course, coverage.callsAvailable),
    bySource: groups(selectedRecords, (row) => row.source, coverage.callsAvailable),
    byCampaign: groups(selectedRecords, (row) => row.campaign, coverage.callsAvailable),
    byMediaBuyer: groups(
      selectedRecords,
      (row) => {
        if (!row.campaign.trim()) return "";
        const buyer = mediaBuyerForCampaign(row.course, row.campaign);
        return buyer && buyer !== "ambiguous"
          ? MEDIA_BUYERS[buyer].name
          : buyer === "ambiguous"
            ? "Ambiguous"
            : "";
      },
      coverage.callsAvailable,
    ),
    bySalesOwner: groups(selectedRecords, (row) => row.salesperson, coverage.callsAvailable),
    bySalesCloser: groups(
      selectedRecords.filter((row) => row.paidOrders.size > 0),
      (row) => row.closer,
      coverage.callsAvailable,
    ).map((row) => ({ ...row, conversionRate: null, lostRate: null })),
    lossReasons: [...reasonMap.values()].sort((a, b) => b.count - a.count),
    unqualifiedReasons: (["customer_data", "course_fit", "unspecified"] as const).map(
      (category) => ({
        category,
        count: selectedRecords.filter((row) => row.unqualifiedCategory === category).length,
      }),
    ),
    coverage,
  };
}
