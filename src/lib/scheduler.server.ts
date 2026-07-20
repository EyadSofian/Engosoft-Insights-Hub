// Server-only: schedules the daily Telegram report inside the running server.
//
// Railway keeps this process always-on, so an in-process timer avoids needing a
// separate cron service. The module-level guard makes scheduling idempotent —
// route modules are imported per-request in dev, and without it every request
// would register another timer and the manager would get duplicate reports.
import { isValidCron, matches, minuteKey, parseCron, zonedNow, type CronFields } from "./cron";

const DEFAULT_CRON = "0 9 * * *";
const TZ = "Africa/Cairo";
/** Well under a minute, so no scheduled minute can be stepped over. */
const TICK_MS = 20_000;

let scheduled = false;
let timer: ReturnType<typeof setInterval> | null = null;
let fields: CronFields | null = null;
let lastFiredMinute = "";
let lastRunAt: string | undefined;
let lastResult: string | undefined;

export interface SchedulerStatus {
  enabled: boolean;
  scheduled: boolean;
  expression: string;
  timezone: string;
  reason?: string;
  lastRunAt?: string;
  lastResult?: string;
}

export function schedulerStatus(): SchedulerStatus {
  const expression = process.env.REPORT_CRON || DEFAULT_CRON;
  // Only the token is required now. Recipients come from whoever sent /start, so
  // demanding TELEGRAM_CHAT_ID up front would leave the schedule disarmed even
  // with a room full of subscribers.
  const enabled = !!process.env.TELEGRAM_BOT_TOKEN;
  return {
    enabled,
    scheduled,
    expression,
    timezone: TZ,
    reason: enabled ? undefined : "TELEGRAM_BOT_TOKEN is not set",
    lastRunAt,
    lastResult,
  };
}

async function fire() {
  lastRunAt = new Date().toISOString();
  try {
    const { sendDaily } = await import("./telegram.server");
    const res = await sendDaily(1, { once: true });
    lastResult = res.skipped
      ? "skipped: already sent today"
      : res.ok
        ? `sent to ${res.sent}${res.failed ? `, ${res.failed} failed` : ""}${res.removed.length ? `, ${res.removed.length} unsubscribed` : ""}`
        : `failed: ${res.error}`;
    if (!res.ok && !res.skipped) console.error("[telegram] daily report failed:", res.error);
  } catch (e) {
    lastResult = `failed: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[telegram] daily report threw:", e);
  }
}

function tick() {
  if (!fields) return;
  const now = zonedNow(new Date(), TZ);
  if (!matches(fields, now)) return;
  // The interval fires several times inside the matching minute.
  const key = minuteKey(now);
  if (key === lastFiredMinute) return;
  lastFiredMinute = key;
  void fire();
}

export function startScheduler(): SchedulerStatus {
  if (scheduled) return schedulerStatus();

  const expression = process.env.REPORT_CRON || DEFAULT_CRON;
  if (!process.env.TELEGRAM_BOT_TOKEN) return schedulerStatus();
  if (!isValidCron(expression)) {
    lastResult = `invalid REPORT_CRON expression: ${expression}`;
    console.error("[telegram]", lastResult);
    return schedulerStatus();
  }

  fields = parseCron(expression);
  timer = setInterval(tick, TICK_MS);
  // Never hold the process open on its own account.
  timer.unref?.();
  scheduled = true;
  return schedulerStatus();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  fields = null;
  scheduled = false;
  lastFiredMinute = "";
}
