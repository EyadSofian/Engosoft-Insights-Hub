import type { CallsHubEmployeeSummary } from "./calls-hub.server";

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const seconds = (value: unknown) =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const cairoDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** PBX facts only. No transcript, recording or analysis service is required. */
export function summarizeYeastarCalls(calls: Row[], extensions: Row[], from: string, to: string) {
  const employees = new Map<string, CallsHubEmployeeSummary>();
  const add = (extension: string, name: string) => {
    let employee = employees.get(extension);
    if (!employee) {
      employee = {
        key: extension,
        extension,
        name: name || `Extension ${extension}`,
        totalCalls: 0,
        answeredCalls: 0,
        analyzedCalls: 0,
        averageScore: null,
        needsReview: 0,
        periodCallSeconds: 0,
        periodTalkSeconds: 0,
        averageCallSeconds: 0,
      };
      employees.set(extension, employee);
    }
    return employee;
  };
  for (const row of extensions) {
    const extension = text(row.extension);
    if (extension) add(extension, text(row.user_name));
  }
  const distinct = new Map<
    string,
    { extension: string; name: string; talk: number; duration: number; answered: boolean }
  >();
  for (const row of calls) {
    if (!["outbound", "inbound"].includes(text(row.direction).toLowerCase())) continue;
    const extension = text(row.extension);
    const id = text(row.call_id);
    const rawDate = text(row.started_at);
    // The ingest contract stores UTC timestamps. Do not use the host timezone
    // if an older row omits the UTC suffix.
    const at = Date.parse(
      /[zZ]$|[+-]\d{2}:?\d{2}$/.test(rawDate) ? rawDate : `${rawDate.replace(" ", "T")}Z`,
    );
    if (!extension || !id || !Number.isFinite(at)) continue;
    const day = cairoDay.format(new Date(at));
    if (day < from || day > to) continue;
    const talk = seconds(row.talk_sec);
    const duration = Math.max(talk, seconds(row.call_duration_sec));
    const key = `${extension}\u0000${id}`;
    const existing = distinct.get(key);
    const answered = talk > 0 || text(row.disposition).toUpperCase() === "ANSWERED";
    // Replayed rows / PBX legs must not multiply the count or talk hours.
    distinct.set(key, {
      extension,
      name: text(row.user_name),
      talk: Math.max(talk, existing?.talk ?? 0),
      duration: Math.max(duration, existing?.duration ?? 0),
      answered: answered || Boolean(existing?.answered),
    });
  }
  for (const call of distinct.values()) {
    const employee = add(call.extension, call.name);
    employee.totalCalls++;
    employee.answeredCalls += Number(call.answered);
    employee.periodTalkSeconds += call.talk;
    employee.periodCallSeconds += call.duration;
  }
  for (const employee of employees.values()) {
    employee.averageCallSeconds = employee.totalCalls
      ? employee.periodCallSeconds / employee.totalCalls
      : 0;
  }
  return [...employees.values()].sort(
    (a, b) => b.totalCalls - a.totalCalls || a.extension.localeCompare(b.extension),
  );
}
