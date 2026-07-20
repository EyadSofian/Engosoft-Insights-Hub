import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Send, Link2, RefreshCw, Eye } from "lucide-react";
import { fmtDateTime, fmtNum, useI18n } from "@/lib/i18n";
import { Card, Notice, Pill, SectionTitle } from "./ui-bits";

interface SetupResp {
  ok: boolean;
  error?: string;
  registered: boolean;
  matchesThisDeployment: boolean;
  expectedUrl: string;
  currentUrl: string | null;
  pendingUpdates: number | null;
  lastError: string | null;
  subscribers: number;
  scheduler: {
    enabled: boolean;
    scheduled: boolean;
    expression: string;
    timezone: string;
    reason?: string;
    lastRunAt?: string;
    lastResult?: string;
  };
  hint: string;
}

/**
 * Bot status, in the dashboard rather than behind a curl command.
 *
 * Every failure mode here is silent by design: an unregistered webhook makes
 * /start reach nothing with no error shown to the sender, and a sleeping
 * container skips the schedule without logging anything. Surfacing the state
 * next to the data it reports on is the only place someone would think to look.
 *
 * The actions are buttons rather than anything automatic — registering a webhook
 * changes configuration on an external service, so it happens on an explicit
 * click.
 */
export function TelegramPanel() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<SetupResp>({
    queryKey: ["telegram-setup"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/setup");
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const ar = lang === "ar";

  const act = async (key: string, url: string, method: "GET" | "POST") => {
    setBusy(key);
    setResult(null);
    try {
      const res = await fetch(url, { method });
      const body = (await res.json()) as Record<string, unknown>;
      const ok = body.ok === true;
      const skipped = body.skipped === true;
      const msg = skipped
        ? ar
          ? "التقرير أُرسل بالفعل اليوم"
          : "Report already sent today"
        : ok
          ? key === "register"
            ? ar
              ? "تم تسجيل الويبهوك. ابعت /start للبوت دلوقتي."
              : "Webhook registered. Send /start to the bot now."
            : ar
              ? `تم الإرسال إلى ${body.sent} مشترك`
              : `Sent to ${body.sent} subscriber(s)`
          : String(body.error ?? (ar ? "فشل" : "failed"));
      setResult({ tone: ok ? "success" : "danger", text: msg });
      await refetch();
      await qc.invalidateQueries({ queryKey: ["telegram-setup"] });
    } catch (e) {
      setResult({ tone: "danger", text: e instanceof Error ? e.message : "failed" });
    } finally {
      setBusy(null);
    }
  };

  const showPreview = async () => {
    setBusy("preview");
    try {
      const res = await fetch("/api/telegram/preview");
      const body = (await res.json()) as { text?: string };
      setPreview(body.text ?? "");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !data) return null;

  const tokenSet = data.scheduler.enabled;
  const webhookOk = data.registered && data.matchesThisDeployment;

  const rows: { label: string; ok: boolean; value: string }[] = [
    {
      label: ar ? "توكن البوت" : "Bot token",
      ok: tokenSet,
      value: tokenSet ? (ar ? "مضبوط" : "set") : ar ? "غير مضبوط" : "not set",
    },
    {
      label: ar ? "الويبهوك" : "Webhook",
      ok: webhookOk,
      value: !data.registered
        ? ar
          ? "غير مسجَّل"
          : "not registered"
        : data.matchesThisDeployment
          ? ar
            ? "مسجَّل على هذا النشر"
            : "registered for this deployment"
          : ar
            ? "مسجَّل على عنوان آخر"
            : "registered for a different URL",
    },
    {
      label: ar ? "المشتركون" : "Subscribers",
      ok: data.subscribers > 0,
      value: fmtNum(data.subscribers),
    },
    {
      label: ar ? "الجدولة" : "Schedule",
      ok: data.scheduler.scheduled,
      value: data.scheduler.scheduled
        ? `${data.scheduler.expression} · ${data.scheduler.timezone}`
        : ar
          ? "متوقفة"
          : "not armed",
    },
  ];

  return (
    <Card>
      <SectionTitle
        hint={ar ? "حالة بوت التقرير اليومي" : "Daily report bot status"}
        action={
          <button
            onClick={() => refetch()}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <RefreshCw size={12} />
            {t("refresh")}
          </button>
        }
      >
        {t("telegram")}
      </SectionTitle>

      {!tokenSet ? (
        <Notice tone="warning" icon={<AlertTriangle size={16} />}>
          {ar
            ? "متغيّر TELEGRAM_BOT_TOKEN غير مضبوط في إعدادات النشر، فالبوت متوقف تماماً."
            : "TELEGRAM_BOT_TOKEN is not set in the deployment, so the bot is entirely off."}
        </Notice>
      ) : (
        !webhookOk && (
          <Notice tone="danger" icon={<AlertTriangle size={16} />}>
            {ar
              ? "الويبهوك غير مسجَّل، ولهذا لا يصل أمر /start إلى التطبيق ولا يُسجَّل أي مشترك — ولا تظهر رسالة خطأ لمن أرسله. اضغط «تسجيل الويبهوك» مرة واحدة."
              : "The webhook is not registered, so /start never reaches the app and nobody is subscribed — with no error shown to the sender. Click Register webhook once."}
          </Notice>
        )
      )}

      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px] mt-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 py-1 border-b border-border/60">
            <span className="text-text-muted">{r.label}</span>
            <span className="inline-flex items-center gap-1.5 shrink-0">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: r.ok ? "var(--success)" : "var(--danger)" }}
              />
              <span className="num font-medium">{r.value}</span>
            </span>
          </div>
        ))}
      </dl>

      {(data.scheduler.lastRunAt || data.lastError) && (
        <div className="mt-3 text-[12px] text-text-muted space-y-1">
          {data.scheduler.lastRunAt && (
            <div>
              {ar ? "آخر تشغيل مجدول" : "Last scheduled run"}:{" "}
              <span className="num">{fmtDateTime(data.scheduler.lastRunAt, lang)}</span>
              {data.scheduler.lastResult && ` — ${data.scheduler.lastResult}`}
            </div>
          )}
          {data.lastError && (
            <div style={{ color: "var(--danger)" }}>
              {ar ? "آخر خطأ من تيليجرام" : "Last Telegram error"}: {data.lastError}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <button
          onClick={() => act("register", "/api/telegram/setup", "POST")}
          disabled={!tokenSet || busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white cursor-pointer disabled:opacity-50 min-h-[40px]"
          style={{ background: webhookOk ? "var(--surface-3)" : "var(--brand)" }}
        >
          <Link2 size={14} />
          {busy === "register"
            ? ar ? "جارٍ التسجيل…" : "Registering…"
            : ar ? "تسجيل الويبهوك" : "Register webhook"}
        </button>

        <button
          onClick={() => act("send", "/api/telegram/send-daily", "POST")}
          disabled={!tokenSet || data.subscribers === 0 || busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 min-h-[40px]"
        >
          <Send size={14} />
          {busy === "send" ? (ar ? "جارٍ الإرسال…" : "Sending…") : t("send_now")}
        </button>

        <button
          onClick={showPreview}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 min-h-[40px]"
        >
          <Eye size={14} />
          {t("preview")}
        </button>
      </div>

      {result && (
        <div className="mt-3">
          <Pill tone={result.tone}>
            {result.tone === "success" ? <Check size={11} className="me-1" /> : null}
            {result.text}
          </Pill>
        </div>
      )}

      {preview !== null && (
        <pre
          className="mt-3 p-3 rounded-lg bg-surface-2 border border-border text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap"
          dir="rtl"
        >
          {preview}
        </pre>
      )}
    </Card>
  );
}
