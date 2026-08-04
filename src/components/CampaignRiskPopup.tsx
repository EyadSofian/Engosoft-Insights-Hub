import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeDollarSign,
  BellOff,
  Clock,
  ReceiptText,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import type { CampaignActivity, CampaignLifetime, PerfRow } from "@/lib/types";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import { PLATFORM_LABEL } from "@/lib/constants";
import { Pill } from "@/components/ui-bits";
import { useModalGuard } from "@/lib/ui-store";
import {
  pendingRiskRows,
  riskAlertPrefs,
  shouldShowRiskAlert,
  useRiskAlertPrefs,
} from "@/lib/campaign-risk-prefs";

interface RiskResponse {
  activity: CampaignActivity;
  generatedAt: string;
  scope: "all_platforms";
}

export function CampaignRiskPopup() {
  const { lang } = useI18n();
  const { pathname } = useLocation();
  const prefs = useRiskAlertPrefs();
  const eligiblePath = pathname === "/";
  // Closing only hides the alert for the current view — it returns on the next
  // page load and every time the overview is opened. Anything longer is an
  // explicit choice made through the snooze/mute buttons.
  const [closed, setClosed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { data } = useQuery<RiskResponse>({
    queryKey: ["campaign-risk", "all-platforms"],
    queryFn: async () => {
      const response = await fetch("/api/campaign-risk");
      if (!response.ok) throw new Error(`Campaign risk request failed: ${response.status}`);
      return response.json();
    },
    staleTime: 5 * 60_000,
    retry: 1,
    enabled: eligiblePath,
  });

  const atRisk = data?.activity.atRisk;
  const rows = useMemo(() => pendingRiskRows(atRisk ?? [], prefs), [atRisk, prefs]);
  const totalActive = (data?.activity.platformHealth ?? [])
    .filter((platform) => platform.ok)
    .reduce((total, platform) => total + platform.active, 0);
  const open = eligiblePath && !closed && shouldShowRiskAlert(rows, prefs);

  useEffect(() => {
    if (pathname === "/") setClosed(false);
  }, [pathname]);

  useEffect(() => {
    if (prefs.restoredAt) setClosed(false);
  }, [prefs.restoredAt]);

  const dismiss = useCallback(() => setClosed(true), []);
  const keys = useMemo(() => rows.map((row) => row.key), [rows]);
  const snooze = useCallback(() => riskAlertPrefs.snooze(keys), [keys]);
  const mute = useCallback(() => riskAlertPrefs.mute(keys), [keys]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [dismiss, open]);

  useModalGuard(open);

  if (!open || !data || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-risk-title"
      onClick={dismiss}
    >
      <section
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface shadow-2xl sm:max-w-4xl sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface/95 p-4 backdrop-blur sm:p-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-danger-soft text-danger">
              <AlertTriangle size={22} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="campaign-risk-title" className="text-lg font-semibold text-text sm:text-xl">
                {lang === "ar" ? "حملات محتاجة مراجعة" : "Campaigns needing review"}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted sm:text-sm">
                {lang === "ar"
                  ? "دي مش قائمة كل الحملات الشغالة. دي بس الحملات الـActive على منصتها وعندها صرف حديث، لكن لسه مفيش Won أو فاتورة مدفوعة أو أمر بيع مفوتر بالكامل."
                  : "This is not the full active-campaign list. It only shows officially Active campaigns with recent spend but no Won, paid invoice, or fully invoiced sales order."}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={dismiss}
            aria-label={lang === "ar" ? "إغلاق التنبيه" : "Close alert"}
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X size={20} />
          </button>
        </header>

        <div className="p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-text">
              {lang === "ar"
                ? `${fmtNum(rows.length)} للمراجعة من أصل ${fmtNum(totalActive)} حملة Active`
                : `${fmtNum(rows.length)} to review out of ${fmtNum(totalActive)} Active campaigns`}
            </div>
            <Pill tone="neutral">
              {lang === "ar" ? "الـStatus من المنصة مباشرة" : "Status comes directly from platform"}
            </Pill>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((row) => (
              <RiskCard
                key={`${row.platforms.join("-")}:${row.key}`}
                row={row}
                lifetime={data.activity.lifetime?.[row.key]}
              />
            ))}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={snooze}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 text-[13px] font-semibold text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <Clock size={15} aria-hidden="true" />
                  {lang === "ar" ? "ذكّرني بكرة" : "Remind me tomorrow"}
                </button>
                <button
                  type="button"
                  onClick={mute}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 text-[13px] font-semibold text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <BellOff size={15} aria-hidden="true" />
                  {lang === "ar" ? "لا تظهر مجددًا" : "Don't show again"}
                </button>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={dismiss}
                  className="min-h-11 cursor-pointer rounded-xl border border-border px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-2"
                >
                  {lang === "ar" ? "إغلاق بعد المراجعة" : "Close after review"}
                </button>
                <a
                  href="/campaigns"
                  onClick={dismiss}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                >
                  {lang === "ar" ? "فتح تفاصيل الحملات" : "Open campaign details"}
                </a>
              </div>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-text-subtle">
              {lang === "ar"
                ? "«لا تظهر مجددًا» تكتم الحملات المعروضة هنا فقط — أي حملة جديدة تدخل الخطر هتنبّهك، وتقدر ترجّع المكتومة من بطاقة «الحملات التي تعمل الآن» في النظرة العامة."
                : "“Don't show again” silences only the campaigns listed here — a newly at-risk campaign still alerts you, and you can unmute from the “Campaigns running now” card on the overview."}
            </p>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function RiskCard({ row, lifetime }: { row: PerfRow; lifetime?: CampaignLifetime }) {
  const { lang } = useI18n();
  return (
    <article className="rounded-2xl border border-danger/25 bg-danger-soft/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-text" title={row.name}>
            {row.name || "—"}
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {row.platforms.map((platform) => (
              <Pill key={platform} tone="neutral">
                {PLATFORM_LABEL[platform][lang]}
              </Pill>
            ))}
          </div>
        </div>
        <Pill tone="danger">{lang === "ar" ? "مراجعة عاجلة" : "Urgent review"}</Pill>
      </div>

      {/* Won, invoices and sales orders are zero by definition here, so the
          card spends its space on the size of the loss instead. */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <RiskMetric
          icon={<BadgeDollarSign size={14} />}
          label={lang === "ar" ? "صرف حديث مسجل" : "Recent recorded spend"}
          value={fmtUSD(row.spend)}
        />
        <RiskMetric
          icon={<ReceiptText size={14} />}
          label={lang === "ar" ? "إجمالي صرف الحملة" : "Campaign lifetime spend"}
          value={lifetime ? fmtUSD(lifetime.spend) : "—"}
        />
        <RiskMetric
          icon={<Users size={14} />}
          label={lang === "ar" ? "ليدز المنصة" : "Platform leads"}
          value={row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
        />
        <RiskMetric
          icon={<Users size={14} />}
          label={lang === "ar" ? "ليدز أودو (الكل)" : "Odoo leads (all time)"}
          value={lifetime ? fmtNum(lifetime.crmLeads) : fmtNum(row.crmLeads)}
        />
      </div>

      {lifetime?.firstSpendDate && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-text-muted">
          <ShoppingCart size={12} aria-hidden="true" />
          {lang === "ar"
            ? `بتصرف من ${lifetime.firstSpendDate} بدون أي بيع مسجّل`
            : `Spending since ${lifetime.firstSpendDate} with no recorded sale`}
        </p>
      )}
    </article>
  );
}

function RiskMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface px-2.5 py-2">
      <div className="flex items-start gap-1 text-[10px] leading-tight text-text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="num mt-1 text-sm font-semibold text-text">{value}</div>
    </div>
  );
}
