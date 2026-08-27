/**
 * Which un-contacted lead is actually urgent, and which one is just noise.
 *
 * The employee tab prints two counters — "لم يتصل بها أحد" and "لم يتصل بها
 * الموظف المسؤول" — and until now both were dead numbers. A reader who saw 995
 * uncalled leads had no way to learn which 995, when they arrived, or which of
 * them still had a deal in them. This module turns the counter into a work
 * queue.
 *
 * The two counters are NOT the same population, and the pop-up has to say so:
 *
 *   never called    = no Yeastar call matched the lead's phone at all
 *   owner uncalled  = the assigned salesperson never called it, which INCLUDES
 *                     every lead a different employee did call
 *
 * so `owner uncalled` is always the larger of the two, and the difference is
 * exactly the leads that were rescued by someone other than their owner. On the
 * live August window that is 1,100 vs 995 — 105 leads worked by a colleague.
 *
 * Split out of the route as a pure module so `scripts/test-uncalled-leads.mjs`
 * can exercise the ranking directly; the server modules import through Vite's
 * resolver and cannot be loaded by a bare Node script.
 */

/** Same three-level vocabulary the course monitor already uses. */
export type UncalledLeadStatus = "critical" | "warning" | "stable";

export type UncalledLeadReason =
  /** Odoo priority is Hot or Very Hot and nobody dialled it. */
  | "hot_priority"
  /** A quotation or proposal is live on the record — the deal is in flight. */
  | "active_deal"
  /** Brand new and still inside the first-response window. */
  | "fresh_window"
  /** `Calling reply?` says the customer answered, yet the PBX has no such call. */
  | "reply_without_call"
  /** Parked stages: Postponed, Not Reached, No Communication. */
  | "stalled_stage"
  /** Actionable but ageing with nothing recorded against it. */
  | "aging_untouched"
  /** Marked Won without a single matching call — a reconciliation flag. */
  | "won_without_call"
  /** Wrong Number, old data, auto-dialer residue: no action is expected. */
  | "junk_stage";

export type LeadStageBucket = "deal" | "fresh" | "stalled" | "junk" | "won" | "other";

/**
 * The first-response window, in days.
 *
 * A lead this young that nobody has phoned is still winnable, which is why it
 * outranks an older record carrying a warmer stage.
 */
export const FRESH_WINDOW_DAYS = 3;

/** Past this age an untouched lead stops being an omission and becomes history. */
export const AGING_WINDOW_DAYS = 21;

const DAY_MS = 86_400_000;

/**
 * Odoo stage labels are bilingual and carry a team suffix.
 *
 * The live pipeline spells them `Interested / مهتم ( sales )` and
 * `Technical Proposal ( presales )`, so the label is split on its language
 * separator, the parenthetical is dropped, and each side is compared whole.
 * Substring matching is deliberately avoided — `Lost Verification` must not
 * become a live deal because `Verification` appears inside it.
 */
function stageParts(stage: string): string[] {
  return stage
    .split("/")
    .map((part) =>
      part
        .replace(/\([^)]*\)/g, " ")
        .trim()
        .toLocaleLowerCase("en"),
    )
    .filter(Boolean);
}

/**
 * Stage vocabulary read from the live export (18,380 CRM rows + 5,511 archived).
 * Every label observed there is placed; anything unknown falls to `other` and is
 * treated as actionable rather than silently dismissed.
 */
const STAGE_BUCKETS: Record<Exclude<LeadStageBucket, "other">, string[]> = {
  won: ["won", "ربح"],
  deal: [
    "quotation",
    "عرض سعر",
    "technical proposal",
    "interested",
    "مهتم",
    "retention",
    "إعادة شراء",
  ],
  fresh: ["fresh", "contact", "awareness", "re-assign"],
  stalled: ["postponed", "not reached", "no communication"],
  junk: ["wrong number", "old data", "old auto dialer", "lost verification"],
};

export function leadStageBucket(stage: string): LeadStageBucket {
  const parts = stageParts(stage);
  if (!parts.length) return "other";
  // Won is tested first: an archived win still carries `Won / ربح` and must
  // never be read as an omission by the sales floor.
  for (const bucket of ["won", "deal", "fresh", "stalled", "junk"] as const) {
    if (parts.some((part) => STAGE_BUCKETS[bucket].includes(part))) return bucket;
  }
  return "other";
}

/** Odoo priority is a four-value list: Cold, Intermediate, Hot, Very Hot. */
export function isHotPriority(priority: string): boolean {
  const value = priority.trim().toLocaleLowerCase("en");
  return value === "hot" || value === "very hot";
}

/**
 * `Calling reply?` is a free custom field the salesperson fills in by hand.
 * `Answered` there with no PBX call behind it means the call happened off the
 * switchboard — or did not happen at all. Either way it is worth reading.
 */
export function claimsAnsweredReply(callingReply: string): boolean {
  return callingReply.trim().toLocaleLowerCase("en") === "answered";
}

/** Whole days between two ISO dates, floored, never negative. */
export function leadAgeDays(createdAt: string, referenceDate: string): number | null {
  const created = Date.parse(`${createdAt.slice(0, 10)}T00:00:00Z`);
  const reference = Date.parse(`${referenceDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(created) || !Number.isFinite(reference)) return null;
  return Math.max(0, Math.floor((reference - created) / DAY_MS));
}

export interface UncalledLeadFacts {
  stage: string;
  priority: string;
  callingReply: string;
  /** Age at the END of the reporting window, not at read time. See the route. */
  ageDays: number | null;
  /** True when any employee reached it — false on the "never called" list. */
  calledByAny: boolean;
}

export interface UncalledLeadSeverity {
  status: UncalledLeadStatus;
  reasons: UncalledLeadReason[];
}

/**
 * A lead the owner never called is ranked by what it would cost to leave it.
 *
 * Order matters only for readability — the status is decided by which reasons
 * fired, not by which one fired first, so a hot lead that is also a live
 * quotation reports both.
 */
export function uncalledLeadSeverity(facts: UncalledLeadFacts): UncalledLeadSeverity {
  const bucket = leadStageBucket(facts.stage);

  // Junk short-circuits everything. A Wrong Number that nobody called is the
  // system working, and letting it inherit `hot_priority` from a stale Odoo
  // field would bury the real work under noise.
  if (bucket === "junk") return { status: "stable", reasons: ["junk_stage"] };

  const reasons: UncalledLeadReason[] = [];
  const age = facts.ageDays;

  if (isHotPriority(facts.priority)) reasons.push("hot_priority");
  if (bucket === "deal") reasons.push("active_deal");
  if (bucket === "fresh" && age !== null && age <= FRESH_WINDOW_DAYS) reasons.push("fresh_window");
  // Only meaningful while no call exists at all; once a colleague reached the
  // lead the reply plausibly came from that call.
  if (!facts.calledByAny && claimsAnsweredReply(facts.callingReply)) {
    reasons.push("reply_without_call");
  }
  if (bucket === "won") reasons.push("won_without_call");
  if (bucket === "stalled") reasons.push("stalled_stage");
  if (!reasons.length && age !== null && age <= AGING_WINDOW_DAYS) reasons.push("aging_untouched");

  const critical = reasons.some(
    (reason) =>
      reason === "hot_priority" ||
      reason === "active_deal" ||
      reason === "fresh_window" ||
      reason === "reply_without_call",
  );
  const warning = reasons.some(
    (reason) =>
      reason === "stalled_stage" || reason === "aging_untouched" || reason === "won_without_call",
  );

  return { status: critical ? "critical" : warning ? "warning" : "stable", reasons };
}

export function severityRank(status: UncalledLeadStatus): number {
  return status === "critical" ? 2 : status === "warning" ? 1 : 0;
}

export type UncalledLeadSort = "urgent" | "newest" | "oldest";

export interface SortableUncalledLead {
  createdAt: string;
  status: UncalledLeadStatus;
  id: string;
}

/**
 * "اللي تاريخها قريب تبقى هي في الأول وحالاتها حرجة".
 *
 * The default puts severity first and recency second, which reads the request
 * the way it was meant: among the rows that are actually critical, the newest
 * one is the one still worth a phone call this morning. `newest` and `oldest`
 * stay available for a reader who wants the plain chronological list.
 */
export function sortUncalledLeads<T extends SortableUncalledLead>(
  rows: T[],
  sort: UncalledLeadSort,
): T[] {
  const byNewest = (left: T, right: T) =>
    right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
  if (sort === "newest") return [...rows].sort(byNewest);
  if (sort === "oldest") {
    return [...rows].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  }
  return [...rows].sort(
    (left, right) =>
      severityRank(right.status) - severityRank(left.status) || byNewest(left, right),
  );
}

export interface MonthlyLeadFact {
  /** `YYYY-MM` taken from the lead's own creation date, not from the window. */
  month: string;
  calledByAny: boolean;
  calledByOwner: boolean;
  /** Calls matched to this lead's phone from any employee, de-duplicated. */
  calls: number;
  outcome: "won" | "lost" | "open";
}

export interface UncalledLeadMonth {
  month: string;
  leads: number;
  called: number;
  uncalled: number;
  ownerCalled: number;
  ownerUncalled: number;
  calls: number;
  /** Calls per assigned lead — the effort ratio, `null` with no leads. */
  callsPerLead: number | null;
  won: number;
  lost: number;
  /** Won ÷ decided. The same definition the tab labels "نسبة الإغلاق". */
  closeRate: number | null;
  /** Won ÷ every assigned lead, matching "تحويل كل الليدز". */
  conversionRate: number | null;
  /** Share of the month's leads that any employee reached. */
  contactRate: number | null;
}

/**
 * Won ÷ decided, or nothing.
 *
 * Two different situations both produce a missing close rate and neither may be
 * printed as a percentage:
 *
 *   nothing decided yet   — a fresh month. 0% would read as "closed nothing".
 *   Lost feed unavailable — every loss is missing from the denominator, so the
 *                           rate computes to a confident 100%. That is the worse
 *                           of the two: it is not merely wrong, it is wrong in
 *                           the flattering direction, on the exact screen where
 *                           people are judged.
 *
 * The dashboard already knows the second case as `health.lostAuthority`, and
 * the caller passes it through rather than letting the arithmetic decide.
 */
export function closeRateOf(won: number, lost: number, lostAvailable: boolean): number | null {
  if (!lostAvailable) return null;
  const decided = won + lost;
  return decided > 0 ? (won / decided) * 100 : null;
}

/**
 * The month rollup behind "نسبة الإغلاق ونسبة المكالمات لليدز بالنسبة للشهر".
 *
 * Leads are bucketed by their own creation month rather than by the selected
 * window, so a Lost record that closed in August but was created in June is
 * counted against June — the month whose intake it actually belongs to.
 */
export function summarizeUncalledMonths(
  facts: MonthlyLeadFact[],
  options: { lostAvailable?: boolean } = {},
): UncalledLeadMonth[] {
  const lostAvailable = options.lostAvailable !== false;
  const months = new Map<string, UncalledLeadMonth>();
  for (const fact of facts) {
    if (!/^\d{4}-\d{2}$/.test(fact.month)) continue;
    const row = months.get(fact.month) ?? {
      month: fact.month,
      leads: 0,
      called: 0,
      uncalled: 0,
      ownerCalled: 0,
      ownerUncalled: 0,
      calls: 0,
      callsPerLead: null,
      won: 0,
      lost: 0,
      closeRate: null,
      conversionRate: null,
      contactRate: null,
    };
    row.leads += 1;
    if (fact.calledByAny) row.called += 1;
    else row.uncalled += 1;
    if (fact.calledByOwner) row.ownerCalled += 1;
    else row.ownerUncalled += 1;
    row.calls += Math.max(0, fact.calls);
    if (fact.outcome === "won") row.won += 1;
    if (fact.outcome === "lost") row.lost += 1;
    months.set(fact.month, row);
  }
  for (const row of months.values()) {
    row.callsPerLead = row.leads > 0 ? row.calls / row.leads : null;
    row.closeRate = closeRateOf(row.won, row.lost, lostAvailable);
    row.conversionRate = row.leads > 0 ? (row.won / row.leads) * 100 : null;
    row.contactRate = row.leads > 0 ? (row.called / row.leads) * 100 : null;
  }
  return [...months.values()].sort((left, right) => left.month.localeCompare(right.month));
}
