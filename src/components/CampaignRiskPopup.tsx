import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeDollarSign,
  ReceiptText,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import type { CampaignActivity, PerfRow } from "@/lib/types";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import { Pill } from "@/components/ui-bits";
import { useModalGuard } from "@/lib/ui-store";

interface RiskResponse {
  activity: CampaignActivity;
  generatedAt: string;
  scope: "all_platforms";
}

export function CampaignRiskPopup() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
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
  });

  const windowKey = data?.activity.window
    ? `${data.activity.window.from}-${data.activity.window.to}`
    : "";
  const storageKey = `engosoft-campaign-risk-seen:${windowKey}`;
  const dismiss = useCallback(() => {
    if (typeof window !== "undefined" && windowKey) {
      window.sessionStorage.setItem(storageKey, new Date().toISOString());
    }
    setOpen(false);
  }, [storageKey, windowKey]);

  useEffect(() => {
    if (!windowKey || !data?.activity.atRisk.length || typeof window === "undefined") return;
    if (!window.sessionStorage.getItem(storageKey)) setOpen(true);
  }, [data?.activity.atRisk.length, storageKey, windowKey]);

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

  if (!open || !data?.activity.atRisk.length || typeof document === "undefined") return null;

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
                {lang === "ar" ? "حملات تحتاج قرارًا الآن" : "Campaigns needing a decision now"}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted sm:text-sm">
                {lang === "ar"
                  ? `إنفاق حديث بلا Won أو فاتورة مدفوعة أو أمر بيع مفوتر بالكامل · ${data.activity.window?.from} → ${data.activity.window?.to}`
                  : `Recent spend with no Won, paid invoice, or fully invoiced sales order · ${data.activity.window?.from} → ${data.activity.window?.to}`}
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
                ? `${fmtNum(data.activity.atRisk.length)} حملة مرتبة حسب الإنفاق`
                : `${fmtNum(data.activity.atRisk.length)} campaigns ranked by spend`}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Pill tone="neutral">Meta</Pill>
              <Pill tone="neutral">Snapchat</Pill>
              <Pill tone="neutral">TikTok</Pill>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {data.activity.atRisk.map((row) => (
              <RiskCard key={row.key} row={row} />
            ))}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
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
      </section>
    </div>,
    document.body,
  );
}

function RiskCard({ row }: { row: PerfRow }) {
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
                {platform === "snapchat" ? "Snapchat" : platform === "tiktok" ? "TikTok" : "Meta"}
              </Pill>
            ))}
          </div>
        </div>
        <Pill tone="danger">{lang === "ar" ? "مراجعة عاجلة" : "Urgent review"}</Pill>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <RiskMetric
          icon={<BadgeDollarSign size={14} />}
          label={lang === "ar" ? "الإنفاق" : "Spend"}
          value={fmtUSD(row.spend)}
        />
        <RiskMetric
          icon={<Users size={14} />}
          label={lang === "ar" ? "ليدز المنصة" : "Platform leads"}
          value={row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
        />
        <RiskMetric
          icon={<Users size={14} />}
          label={lang === "ar" ? "ليدز أودو" : "Odoo leads"}
          value={fmtNum(row.crmLeads)}
        />
        <RiskMetric
          icon={<ReceiptText size={14} />}
          label={lang === "ar" ? "الفواتير" : "Invoices"}
          value={fmtNum(row.invoices)}
        />
        <RiskMetric
          icon={<ShoppingCart size={14} />}
          label={lang === "ar" ? "أوامر البيع" : "Sales orders"}
          value={fmtNum(row.salesOrders)}
        />
      </div>
    </article>
  );
}

function RiskMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] text-text-muted">
        {icon}
        <span className="truncate" title={label}>
          {label}
        </span>
      </div>
      <div className="num mt-1 text-sm font-semibold text-text">{value}</div>
    </div>
  );
}
