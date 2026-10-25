import {
  callCanCoverLead,
  leadCallAggregateKey,
  type DatedLeadCallAggregate,
} from "./uncalled-leads";

/**
 * One contact-evidence resolver for every lead-level question.
 *
 * The uncalled-leads queue, the employee evidence drawer and the employee
 * coverage counters used to repeat this join with small differences: one read
 * only `phone || mobile`, one kept a private phone key, one never looked at
 * Chatwoot, and a Calls Hub outage silently became "no calls". A lead the
 * pop-up called uncontacted could therefore be contacted in the drawer.
 *
 * Rules, in one place:
 *   - both `phone` and `mobile` are matched;
 *   - numbers are normalised (Arabic-Indic digits, 00/+ prefixes, Egyptian
 *     `01…`, Saudi `05…`) and keyed by their final nine digits, the key the
 *     Calls Hub and the stored Chatwoot evidence already share; two numbers
 *     confidently parsed to different countries never match on that key;
 *   - a call counts only on or after the lead's creation day;
 *   - an employee chat reply counts only inside the reporting window and after
 *     the lead was created (Cairo business days);
 *   - evidence is complete only when the Calls Hub was read and Chatwoot holds
 *     authoritative evidence for every number on the lead. Without that a lead
 *     with no contact found is `unknown`, never "not contacted".
 */

export const LEAD_CONTACT_EVIDENCE_VERSION = "lead-contact-evidence/1";
export const BUSINESS_TIME_ZONE = "Africa/Cairo";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export type PhoneCountry = "EG" | "SA" | "other" | "unknown";

export interface NormalizedPhone {
  digits: string;
  /** E.164 when the country is known or the number arrived in international form. */
  e164: string | null;
  country: PhoneCountry;
  /** Final nine digits, or "" for anything shorter (an extension is never a phone). */
  key: string;
}

function asciiDigits(value: string): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EXTENDED_ARABIC_INDIC.indexOf(digit)));
}

export function phoneDigits(value: string): string {
  return asciiDigits(value).replace(/\D/g, "");
}

/** The shared match key. Identical to the Chatwoot evidence store's key. */
export function phoneMatchKey(value: string): string {
  const digits = phoneDigits(value);
  return digits.length >= 9 ? digits.slice(-9) : "";
}

export function normalizePhone(value: string): NormalizedPhone {
  const ascii = asciiDigits(value).trim();
  const digits = ascii.replace(/\D/g, "");
  const key = digits.length >= 9 ? digits.slice(-9) : "";
  const international = ascii.startsWith("+") || digits.startsWith("00");
  const national = digits.startsWith("00") ? digits.slice(2) : digits;

  const egyptian =
    /^20(1[0125]\d{8})$/.exec(national) ??
    (!international ? (/^0(1[0125]\d{8})$/.exec(digits) ?? /^(1[0125]\d{8})$/.exec(digits)) : null);
  if (egyptian) return { digits, e164: `+20${egyptian[1]}`, country: "EG", key };

  const saudi =
    /^966(5\d{8})$/.exec(national) ??
    (!international ? (/^0(5\d{8})$/.exec(digits) ?? /^(5\d{8})$/.exec(digits)) : null);
  if (saudi) return { digits, e164: `+966${saudi[1]}`, country: "SA", key };

  if ((international || national.length >= 11) && national.length >= 10 && national.length <= 15) {
    const country: PhoneCountry = national.startsWith("966")
      ? "SA"
      : national.startsWith("20")
        ? "EG"
        : "other";
    return { digits, e164: `+${national}`, country, key };
  }
  return { digits, e164: null, country: "unknown", key };
}

/**
 * Same subscriber: equal nine-digit keys, unless both numbers were parsed with
 * confidence to two different countries (an Egyptian `015…` and a Saudi `5…`
 * can share their last nine digits). Anything less certain keeps the key match,
 * so a PBX trunk prefix never hides a real call.
 */
export function samePhoneIdentity(left: NormalizedPhone, right: NormalizedPhone): boolean {
  if (!left.key || left.key !== right.key) return false;
  const known = (country: PhoneCountry) => country === "EG" || country === "SA";
  if (known(left.country) && known(right.country) && left.country !== right.country) return false;
  return true;
}

/* --- Cairo business days ------------------------------------------------------ */

function cairoOffsetMinutes(instant: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, timeZoneName: "shortOffset" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+2";
  const match = /GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/.exec(name);
  if (!match || !match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** First and last second (unix) of a Cairo calendar day, or null for a non-date. */
export function cairoDayBoundsUnix(day: string): { start: number; end: number } | null {
  const value = String(day ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const utcMidnight = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(utcMidnight)) return null;
  // Noon avoids reading the offset on the far side of a DST switch.
  const offset = cairoOffsetMinutes(new Date(utcMidnight + 12 * 3_600_000));
  const start = Math.floor((utcMidnight - offset * 60_000) / 1000);
  return { start, end: start + 86_399 };
}

/* --- evidence --------------------------------------------------------------- */

export interface EvidenceCall extends DatedLeadCallAggregate {
  totalCalls: number;
  latestCallId: string;
}

export interface EvidenceChat {
  phoneKey: string;
  conversationId: number;
  status: string;
  assigneeName: string;
  agentNames?: string[];
  lastActivityAt: number;
  agentContactedAt: number;
  customerMessagedAt: number;
  awaitingReply: boolean;
  url: string;
}

export interface LeadContactSubject {
  id: string;
  phone: string;
  mobile: string;
  createdAt: string;
}

export interface ContactEvidenceContext<C extends EvidenceCall = EvidenceCall> {
  window: { from: string; to: string };
  /** Calls keyed by `phoneMatchKey`. */
  callsByPhone: ReadonlyMap<string, readonly C[]>;
  /** False when the Calls Hub read failed: absence of calls then proves nothing. */
  callsAvailable: boolean;
  /** Chat evidence keyed by `phoneMatchKey`; a present key is authoritative for that number. */
  chatsByPhone: ReadonlyMap<string, readonly EvidenceChat[]>;
  chatwootAvailable: boolean;
  isOwnerCall: (call: C) => boolean;
  isOwnerChatName: (name: string) => boolean;
  callUrl?: (callId: string) => string | null;
}

export type ContactStatus = "contacted" | "not_contacted" | "unknown";
export type EvidenceSource = "yeastar" | "chatwoot";

export interface LeadContactEvidence<C extends EvidenceCall = EvidenceCall> {
  leadId: string;
  phoneKeys: string[];
  calledByAny: boolean;
  calledByOwner: boolean;
  /** An employee replied to, or wrote to, the customer in Chatwoot. */
  contactedViaChat: boolean;
  chatByOwner: boolean;
  /** The customer's latest message has no employee reply yet. */
  chatAwaitingReply: boolean;
  /** At least one conversation where only the customer wrote. */
  customerOnlyChat: boolean;
  contactedByAny: boolean;
  contactedByOwner: boolean;
  totalCalls: number;
  ownerCalls: number;
  callers: string[];
  firstCallAt: string | null;
  latestCallAt: string | null;
  latestCallUrl: string | null;
  latestOwnerCallUrl: string | null;
  chatConversationCount: number;
  chatAssignees: string[];
  latestChatAt: number | null;
  latestChatUrl: string | null;
  latestChatStatus: string | null;
  /** Calls Hub read and Chatwoot evidence present for every number on the lead. */
  evidenceComplete: boolean;
  evidenceSources: EvidenceSource[];
  missingSources: EvidenceSource[];
  /** Why the lead cannot be matched at all. */
  unmatchableReason: "no_phone" | null;
  contactStatus: ContactStatus;
  ownerContactStatus: ContactStatus;
  version: string;
  /** De-duplicated call aggregates behind the counts, for callers that total calls. */
  matchedCalls: C[];
  ownerMatchedCalls: C[];
}

export function indexCallsByPhone<C extends { phone: string }>(
  calls: readonly C[],
): Map<string, C[]> {
  const index = new Map<string, C[]>();
  for (const call of calls) {
    const key = phoneMatchKey(call.phone);
    if (!key) continue;
    const rows = index.get(key);
    if (rows) rows.push(call);
    else index.set(key, [call]);
  }
  return index;
}

/** Every distinct match key on a lead, phone first. */
export function leadPhoneKeys(lead: { phone: string; mobile: string }): string[] {
  return [...new Set([lead.phone, lead.mobile].map(phoneMatchKey).filter(Boolean))];
}

export function resolveLeadContactEvidence<C extends EvidenceCall>(
  lead: LeadContactSubject,
  context: ContactEvidenceContext<C>,
): LeadContactEvidence<C> {
  const phones = [lead.phone, lead.mobile]
    .map(normalizePhone)
    .filter(
      (phone, index, all) =>
        phone.key && all.findIndex((other) => other.key === phone.key) === index,
    );
  const phoneKeys = phones.map((phone) => phone.key);

  const matches = new Map<string, C>();
  for (const phone of phones) {
    for (const call of context.callsByPhone.get(phone.key) ?? []) {
      if (!samePhoneIdentity(phone, normalizePhone(call.phone))) continue;
      if (!callCanCoverLead(call, lead.createdAt)) continue;
      matches.set(leadCallAggregateKey(call), call);
    }
  }
  const matchedCalls = [...matches.values()];
  const ownerMatchedCalls = matchedCalls.filter((call) => context.isOwnerCall(call));
  const newestCall = (calls: C[]) =>
    calls
      .filter((call) => call.latestCallId)
      .sort((left, right) => right.latestCallAt.localeCompare(left.latestCallAt))[0];
  const urlOf = (call: C | undefined) =>
    call && context.callUrl ? context.callUrl(call.latestCallId) : null;

  const windowStart = cairoDayBoundsUnix(context.window.from)?.start ?? Number.NEGATIVE_INFINITY;
  const windowEnd = cairoDayBoundsUnix(context.window.to)?.end ?? Number.POSITIVE_INFINITY;
  const createdStart = cairoDayBoundsUnix(lead.createdAt)?.start ?? Number.NEGATIVE_INFINITY;
  const floor = Math.max(windowStart, createdStart);

  const conversations = new Map<number, EvidenceChat>();
  for (const key of phoneKeys) {
    for (const chat of context.chatsByPhone.get(key) ?? [])
      conversations.set(chat.conversationId, chat);
  }
  const chats = [...conversations.values()];
  const listed = chats
    .filter((chat) => chat.lastActivityAt >= floor && chat.lastActivityAt <= windowEnd)
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt);
  const employeeChats = chats.filter(
    (chat) =>
      chat.agentContactedAt > 0 &&
      chat.agentContactedAt >= floor &&
      chat.agentContactedAt <= windowEnd,
  );
  const chatNames = (chat: EvidenceChat) =>
    [...(chat.agentNames ?? []), chat.assigneeName].filter(Boolean);
  const ownerChats = employeeChats.filter((chat) => chatNames(chat).some(context.isOwnerChatName));
  const createdFloor = Number.isFinite(createdStart) ? createdStart : 0;
  const chatAwaitingReply = listed.some(
    (chat) => chat.awaitingReply && chat.customerMessagedAt >= createdFloor,
  );
  const customerOnlyChat = listed.some(
    (chat) =>
      chat.customerMessagedAt >= createdFloor &&
      chat.customerMessagedAt > 0 &&
      !(chat.agentContactedAt > 0),
  );

  const calledByAny = matchedCalls.length > 0;
  const calledByOwner = ownerMatchedCalls.length > 0;
  const contactedViaChat = employeeChats.length > 0;
  const chatByOwner = ownerChats.length > 0;
  const contactedByAny = calledByAny || contactedViaChat;
  const contactedByOwner = calledByOwner || chatByOwner;

  const callsKnown = context.callsAvailable;
  const chatKnown =
    context.chatwootAvailable &&
    phoneKeys.length > 0 &&
    phoneKeys.every((key) => context.chatsByPhone.has(key));
  const evidenceSources: EvidenceSource[] = [];
  const missingSources: EvidenceSource[] = [];
  (callsKnown ? evidenceSources : missingSources).push("yeastar");
  (chatKnown ? evidenceSources : missingSources).push("chatwoot");
  const evidenceComplete = phoneKeys.length > 0 && callsKnown && chatKnown;
  const status = (contacted: boolean): ContactStatus =>
    contacted ? "contacted" : evidenceComplete ? "not_contacted" : "unknown";

  const latestChat = listed[0] ?? null;
  const callTimes = matchedCalls
    .flatMap((call) => [call.firstCallAt, call.latestCallAt])
    .filter(Boolean);
  return {
    leadId: lead.id,
    phoneKeys,
    calledByAny,
    calledByOwner,
    contactedViaChat,
    chatByOwner,
    chatAwaitingReply,
    customerOnlyChat,
    contactedByAny,
    contactedByOwner,
    totalCalls: matchedCalls.reduce((sum, call) => sum + call.totalCalls, 0),
    ownerCalls: ownerMatchedCalls.reduce((sum, call) => sum + call.totalCalls, 0),
    callers: [...new Set(matchedCalls.map((call) => call.agentName).filter(Boolean))],
    firstCallAt: [...callTimes].sort()[0] ?? null,
    latestCallAt: [...callTimes].sort().at(-1) ?? null,
    latestCallUrl: urlOf(newestCall(matchedCalls)),
    latestOwnerCallUrl: urlOf(newestCall(ownerMatchedCalls)),
    chatConversationCount: listed.length,
    chatAssignees: [...new Set(listed.flatMap(chatNames))],
    latestChatAt: latestChat?.lastActivityAt ?? null,
    latestChatUrl: latestChat?.url ?? null,
    latestChatStatus: latestChat
      ? String(latestChat.status || "")
          .trim()
          .toLowerCase() || null
      : null,
    evidenceComplete,
    evidenceSources,
    missingSources,
    unmatchableReason: phoneKeys.length ? null : "no_phone",
    contactStatus: status(contactedByAny),
    ownerContactStatus: status(contactedByOwner),
    version: LEAD_CONTACT_EVIDENCE_VERSION,
    matchedCalls,
    ownerMatchedCalls,
  };
}

/** The evidence object an API returns: counts and links, without the raw call rows. */
export function publicContactEvidence<C extends EvidenceCall>(evidence: LeadContactEvidence<C>) {
  const { matchedCalls: _matched, ownerMatchedCalls: _owner, ...rest } = evidence;
  return rest;
}

export type PublicLeadContactEvidence = ReturnType<typeof publicContactEvidence>;
