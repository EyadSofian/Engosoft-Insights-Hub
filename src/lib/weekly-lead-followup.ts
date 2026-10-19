import { callCanCoverLead, leadCallAggregateKey } from "./uncalled-leads";
import { indexCallsByPhone, normalizePhone, samePhoneIdentity } from "./lead-contact-evidence";
import type { CallsHubLeadCallAggregate } from "./calls-hub.server";

export interface WeeklyLeadSubject {
  id: string;
  createdAt: string;
  phone: string;
  mobile: string;
}

export type WeeklyCallStatus = "answered" | "attempted_no_answer" | "no_pbx_record" | "unknown";

/** Monday-start calendar weeks. UTC arithmetic is safe because inputs are Cairo calendar dates. */
export function weeklyWindow(day: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

export function weeklyCallEvidence(
  lead: WeeklyLeadSubject,
  callsByPhone: Map<string, CallsHubLeadCallAggregate[]>,
  callsAvailable: boolean,
): { status: WeeklyCallStatus; attempts: number; answeredCalls: number; retriedNoAnswer: boolean } {
  const phones = [lead.phone, lead.mobile]
    .map(normalizePhone)
    .filter((phone, index, all) => phone.key && all.findIndex((other) => other.key === phone.key) === index);
  if (!callsAvailable || !phones.length) {
    return { status: "unknown", attempts: 0, answeredCalls: 0, retriedNoAnswer: false };
  }
  const matched = new Map<string, CallsHubLeadCallAggregate>();
  for (const phone of phones) {
    for (const call of callsByPhone.get(phone.key) ?? []) {
      if (!samePhoneIdentity(phone, normalizePhone(call.phone))) continue;
      if (!callCanCoverLead(call, lead.createdAt)) continue;
      matched.set(leadCallAggregateKey(call), call);
    }
  }
  const calls = [...matched.values()];
  const attempts = calls.reduce((total, call) => total + call.totalCalls, 0);
  const answeredCalls = calls.reduce((total, call) => total + call.answeredCalls, 0);
  const status: WeeklyCallStatus = answeredCalls > 0
    ? "answered"
    : attempts > 0
      ? "attempted_no_answer"
      : "no_pbx_record";
  // An aggregate proves repeated dial attempts, not the chronological order of individual calls.
  return { status, attempts, answeredCalls, retriedNoAnswer: status === "attempted_no_answer" && attempts >= 2 };
}

export { indexCallsByPhone };
