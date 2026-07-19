// Server-only: schedules the daily Telegram report inside the running server.
//
// Railway keeps this process always-on, so a node-cron job avoids needing a
// separate cron service. The module-level guard makes scheduling idempotent —
// route modules are imported per-request in dev, and without it every request
// would register another job and the manager would get duplicate reports.
import cron from "node-cron";

const DEFAULT_CRON = "0 9 * * *";
const TZ = "Africa/Cairo";

let scheduled = false;
let task: cron.ScheduledTask | null = null;

export interface SchedulerStatus {
  enabled: boolean;
  scheduled: boolean;
  expression: string;
  timezone: string;
  reason?: string;
  lastRunAt?: string;
  lastResult?: string;
}

let lastRunAt: string | undefined;
let lastResult: string | undefined;

export function schedulerStatus(): SchedulerStatus {
  const expression = process.env.REPORT_CRON || DEFAULT_CRON;
  const enabled = !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
  return {
    enabled,
    scheduled,
    expression,
    timezone: TZ,
    reason: enabled ? undefined : "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set",
    lastRunAt,
    lastResult,
  };
}

export function startScheduler(): SchedulerStatus {
  if (scheduled) return schedulerStatus();

  const expression = process.env.REPORT_CRON || DEFAULT_CRON;
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return schedulerStatus();
  }
  if (!cron.validate(expression)) {
    lastResult = `invalid REPORT_CRON expression: ${expression}`;
    return schedulerStatus();
  }

  task = cron.schedule(
    expression,
    () => {
      void (async () => {
        lastRunAt = new Date().toISOString();
        try {
          const { sendDaily } = await import("./telegram.server");
          const res = await sendDaily(1);
          lastResult = res.ok ? "sent" : `failed: ${res.error}`;
          if (!res.ok) console.error("[telegram] daily report failed:", res.error);
        } catch (e) {
          lastResult = `failed: ${e instanceof Error ? e.message : String(e)}`;
          console.error("[telegram] daily report threw:", e);
        }
      })();
    },
    { timezone: TZ },
  );

  scheduled = true;
  return schedulerStatus();
}

export function stopScheduler() {
  task?.stop();
  task = null;
  scheduled = false;
}
