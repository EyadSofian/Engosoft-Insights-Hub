// Server-only: builds and sends the Arabic daily report to Telegram.
//
// The bot token is read from the environment and never logged, echoed in a
// response body, or included in an error message.
import { getFiltered, computeTotals, computePerf, bestCampaign, moneyLeak, div } from "./metrics.server";
import { loadAllData } from "./sheet-cache.server";
import { dashboardUrl } from "./constants";
import type { Maybe, PerfRow, Totals } from "./types";

const API = "https://api.telegram.org";

export function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}
export function chatId(): string {
  return process.env.TELEGRAM_CHAT_ID ?? "";
}
export function reportLang(): "ar" | "en" {
  return process.env.REPORT_LANG === "en" ? "en" : "ar";
}

/* --- formatting ------------------------------------------------------------ */

/** Telegram MarkdownV2 reserves these; every literal one must be escaped. */
export function esc(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => "\\" + m);
}

const EM = "—";
const money = (n: Maybe, digits = 0) =>
  n === null || !isFinite(n)
    ? EM
    : "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const int = (n: Maybe) => (n === null || !isFinite(n) ? EM : Math.round(n).toLocaleString("en-US"));
const pct = (n: Maybe, d = 1) => (n === null || !isFinite(n) ? EM : n.toFixed(d) + "%");
const times = (n: Maybe) => (n === null || !isFinite(n) ? EM : n.toFixed(2) + "×");

/** Signed change, or an em dash when there is no baseline to compare against. */
function change(now: number, prev: number): string {
  if (!prev) return EM;
  const g = ((now - prev) / Math.abs(prev)) * 100;
  const arrow = g > 1 ? "▲" : g < -1 ? "▼" : "▬";
  return `${arrow} ${g >= 0 ? "+" : ""}${g.toFixed(0)}%`;
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

/* --- report ---------------------------------------------------------------- */

export interface ReportOptions {
  /** Number of days the report covers. 1 = daily, 7 = weekly. */
  days?: number;
  /** Explicit end date (inclusive). Defaults to yesterday. */
  to?: string;
}

interface Period {
  from: string;
  to: string;
  totals: Totals;
  rows: PerfRow[];
}

async function period(from: string, to: string): Promise<Period> {
  const data = await getFiltered({ from, to });
  return { from, to, totals: computeTotals(data), rows: computePerf(data, "campaign") };
}

export async function buildReport(opts: ReportOptions = {}): Promise<string> {
  const days = Math.max(1, opts.days ?? 1);
  const to = opts.to ?? isoDay(1);
  // The window always runs backwards from `to`, so an explicit end date and a
  // multi-day report compose correctly instead of the range silently detaching.
  const dayBefore = (d: string, n: number) =>
    new Date(Date.parse(d + "T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
  const from = dayBefore(to, days - 1);
  const prevTo = dayBefore(from, 1);
  const prevFrom = dayBefore(prevTo, days - 1);

  const [cur, prev, snapshot] = await Promise.all([
    period(from, to),
    period(prevFrom, prevTo),
    loadAllData(),
  ]);

  const t = cur.totals;
  const p = prev.totals;
  const L: string[] = [];

  // A report built on a stale sheet is worse than no report — say so up front.
  if (snapshot.syncedAt) {
    const age = Date.now() - Date.parse(snapshot.syncedAt);
    if (isFinite(age) && age > 24 * 3600 * 1000) {
      const hours = Math.round(age / 3_600_000);
      L.push(`⚠️ *${esc("تنبيه: البيانات لم تُحدَّث منذ")} ${hours} ${esc("ساعة")}*`);
      L.push("");
    }
  }

  const title = days === 1 ? "التقرير اليومي" : `تقرير آخر ${days} أيام`;
  L.push(`📊 *${esc(title)}* — ${esc("إنجوسوفت")}`);
  L.push(esc(days === 1 ? `يوم ${to}` : `من ${from} إلى ${to}`));
  L.push(esc(`مقارنة بـ ${prevFrom} → ${prevTo}`));
  L.push("");

  L.push(`💰 *${esc("الإنفاق الإعلاني")}*`);
  L.push(esc(`الإجمالي: ${money(t.spend, 2)}  ${change(t.spend, p.spend)}`));
  L.push(esc(`ميتا: ${money(t.spendMeta, 2)} · سناب شات: ${money(t.spendSnap, 2)}`));
  if (t.nonLeadSpend > 0) {
    L.push(esc(`منها ${money(t.nonLeadSpend, 2)} على حسابات لا تنتج عملاء (زيارات فقط).`));
  }
  L.push("");

  L.push(`👥 *${esc("العملاء المحتملون")}*`);
  L.push(esc(`دخل النظام: ${int(t.crmLeads)}  ${change(t.crmLeads, p.crmLeads)}`));
  L.push(esc(`من حملات: ${int(t.leadsFromCampaign)} · من مصادر أخرى: ${int(t.leadsOther)}`));
  L.push(esc(`ما أبلغت عنه ميتا: ${int(t.platformLeads)}`));
  L.push("");

  L.push(`🏆 *${esc("الإغلاق")}*`);
  L.push(esc(`صفقات مغلقة: ${int(t.won)} (${pct(t.conversionRate)})  ${change(t.won, p.won)}`));
  L.push(esc(`ضائعة: ${int(t.lost)} (${pct(t.lostRate)})`));
  L.push(esc(`قيمة الفواتير الصادرة: ${money(t.revenue)}  ${change(t.revenue, p.revenue)}`));
  L.push("");

  L.push(`📈 *${esc("مؤشرات الكفاءة")}*`);
  L.push(esc(`تكلفة العميل المحتمل: ${money(t.cpl, 2)}  ${change(t.cpl ?? 0, p.cpl ?? 0)}`));
  L.push(esc(`تكلفة الصفقة المغلقة: ${money(t.cpa, 2)}`));
  L.push(esc(`العائد على الإنفاق: ${times(t.roas)} · نسبة الإنفاق للإيراد: ${pct(t.acos)}`));
  L.push("");

  const best = bestCampaign(cur.rows, 1);
  if (best) {
    L.push(`✅ *${esc("أفضل حملة")}*`);
    L.push(esc(`${best.name}`));
    L.push(
      esc(
        `أنفقت ${money(best.spend, 2)} وأعادت ${money(best.revenue)} · العائد ${times(best.roas)} · تكلفة العميل ${money(best.cpl, 2)}`,
      ),
    );
    L.push("");
  }

  const leak = moneyLeak(cur.rows, 1);
  if (leak && leak.key !== best?.key) {
    L.push(`⚠️ *${esc("أكبر إهدار")}*`);
    L.push(esc(`${leak.name}`));
    const reason =
      leak.revenue <= 0
        ? `أنفقت ${money(leak.spend, 2)} ولم تُعد أي إيراد.`
        : `أنفقت ${money(leak.spend, 2)} وأعادت ${money(leak.revenue)} فقط (${times(leak.roas)}).`;
    L.push(esc(reason));
    L.push("");
  }

  // Plain-language notes, so a non-analyst knows what changed and why.
  const notes: string[] = [];
  if (t.cpl !== null && p.cpl !== null && p.cpl > 0) {
    const g = ((t.cpl - p.cpl) / p.cpl) * 100;
    if (Math.abs(g) >= 15) {
      // Naming the top spender as the *cause* of a CPL move is a claim the data
      // does not support, so it is reported as context, not as an explanation.
      const topSpender = [...cur.rows].filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend)[0];
      notes.push(
        `تكلفة العميل ${g > 0 ? "ارتفعت" : "انخفضت"} بنسبة ${Math.abs(g).toFixed(0)}% مقارنة بالفترة السابقة${topSpender ? `، وأعلى حملة إنفاقاً في الفترة هي ${topSpender.name}` : ""}.`,
      );
    }
  }
  if (t.spend > 0 && t.crmLeads === 0) {
    notes.push("أُنفق مال دون وصول أي عميل محتمل في هذه الفترة — يُراجع ربط النماذج فوراً.");
  }
  if (t.revenue === 0 && t.spend > 0) {
    notes.push("لم تُسجَّل أي فاتورة في هذه الفترة، لذلك يظهر العائد على الإنفاق صفراً.");
  }
  const ratio = div(t.leadsOther, t.crmLeads);
  if (ratio !== null && ratio > 0.4) {
    notes.push(
      `${pct(ratio * 100, 0)} من العملاء جاءوا من مصادر بلا حملة إعلانية، لذلك لا تُقاس كفاءة الإعلانات على الرقم الإجمالي.`,
    );
  }
  if (notes.length) {
    L.push(`📝 *${esc("ملاحظات")}*`);
    for (const n of notes.slice(0, 2)) L.push(esc("• " + n));
    L.push("");
  }

  const url = dashboardUrl();
  if (url) L.push(`[${esc("افتح لوحة التحليلات")}](${url})`);

  return L.join("\n");
}

/* --- transport -------------------------------------------------------------- */

export async function sendMessage(text: string, to?: string): Promise<{ ok: boolean; error?: string }> {
  const token = botToken();
  const target = to || chatId();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set" };
  if (!target) return { ok: false, error: "no recipient: nobody has sent /start and TELEGRAM_CHAT_ID is not set" };

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: target,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !body.ok) {
      // Telegram echoes the request URL in some errors; only its description is
      // surfaced so the token can never leak into a log or response.
      return { ok: false, error: body.description ?? `Telegram returned ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export interface BroadcastResult {
  ok: boolean;
  error?: string;
  text: string;
  sent: number;
  failed: number;
  /** Chats that no longer accept messages and were dropped from the list. */
  removed: string[];
}

/**
 * Builds the report once and sends it to every subscriber.
 *
 * A user who blocks the bot or deletes the chat makes Telegram return 403
 * forever. Those chats are unsubscribed automatically, otherwise the failure
 * count grows every day and real delivery problems get lost in the noise.
 */
export async function sendDaily(days = 1): Promise<BroadcastResult> {
  const { recipients, unsubscribe } = await import("./subscribers.server");

  const text = await buildReport({ days });
  const chats = await recipients();

  if (!botToken()) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set", text, sent: 0, failed: 0, removed: [] };
  if (!chats.length) {
    return {
      ok: false,
      error: "no subscribers yet — send /start to the bot, or set TELEGRAM_CHAT_ID",
      text,
      sent: 0,
      failed: 0,
      removed: [],
    };
  }

  let sent = 0;
  let failed = 0;
  const removed: string[] = [];
  const errors: string[] = [];

  for (const chat of chats) {
    const res = await sendMessage(text, chat);
    if (res.ok) {
      sent++;
      continue;
    }
    failed++;
    const reason = res.error ?? "";
    if (/blocked|chat not found|deactivated|kicked|user is deactivated/i.test(reason)) {
      await unsubscribe(chat);
      removed.push(chat);
    } else {
      errors.push(reason);
    }
  }

  return {
    ok: sent > 0,
    error: sent > 0 ? undefined : errors[0] || "delivery failed for every subscriber",
    text,
    sent,
    failed,
    removed,
  };
}
