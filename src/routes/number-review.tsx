import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Clock,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Card, ErrorState, Notice, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DashboardPageHeader } from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { buildQuery, useFilters } from "@/lib/filter-store";
import { fmtNum, fmtUSDFull, useI18n } from "@/lib/i18n";
import type {
  ReconciliationCheck,
  ReconciliationStatus,
  SourceGroup,
  SourceReconciliation,
} from "@/lib/source-reconciliation.server";

export const Route = createFileRoute("/number-review")({ component: NumberReview });

/* -- how each status reads to someone who is not a data analyst ------------ */

const STATUS_TEXT: Record<ReconciliationStatus, { ar: string; en: string }> = {
  MATCHED: { ar: "مطابق", en: "Matched" },
  SMALL_DIFFERENCE: { ar: "فرق بسيط", en: "Small difference" },
  MISMATCH: { ar: "محتاج مراجعة", en: "Needs review" },
  SOURCE_UNAVAILABLE: { ar: "مش متأكدين", en: "Not verified" },
  STALE: { ar: "قديم", en: "Stale" },
  NOT_VALIDATED: { ar: "لسه ماتراجعش", en: "Not checked yet" },
};

const STATUS_WHY: Record<ReconciliationStatus, { ar: string; en: string }> = {
  MATCHED: {
    ar: "سألنا المصدر نفسه والرقم طلع زيّه بالظبط.",
    en: "We asked the source itself and the number came back the same.",
  },
  SMALL_DIFFERENCE: {
    ar: "فيه فرق صغير، عادةً بسبب آخر يوم لسه بيتحدّث أو دفعة اتسجّلت الساعة اللي فاتت.",
    en: "A small gap, usually the last day still settling or a payment recorded in the past hour.",
  },
  MISMATCH: {
    ar: "الرقم في الداشبورد مش زي المصدر. محتاج يتصلّح قبل حد يبني عليه قرار.",
    en: "The dashboard does not agree with the source. Fix it before anyone decides on it.",
  },
  SOURCE_UNAVAILABLE: {
    ar: "مقدرناش نسأل المصدر، فالرقم معروض بس محدش راجعه. متعاملوش كأنه مظبوط.",
    en: "We could not ask the source, so the number is shown but unchecked. Do not treat it as confirmed.",
  },
  STALE: {
    ar: "النسخة اللي الداشبورد بيقرأ منها قديمة.",
    en: "The copy the dashboard reads is old.",
  },
  NOT_VALIDATED: {
    ar: "الرقم ده لسه مش داخل في المراجعة الآلية.",
    en: "This number is not part of the automated check yet.",
  },
};

/** Colour carries the verdict, so it has to mean exactly one thing here. */
const STATUS_STYLE: Record<ReconciliationStatus, { pill: string; dot: string; icon: ReactNode }> = {
  MATCHED: {
    pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    dot: "bg-emerald-500",
    icon: <Check size={14} aria-hidden="true" />,
  },
  SMALL_DIFFERENCE: {
    pill: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    dot: "bg-amber-400",
    icon: <TriangleAlert size={14} aria-hidden="true" />,
  },
  MISMATCH: {
    pill: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    dot: "bg-rose-500",
    icon: <CircleAlert size={14} aria-hidden="true" />,
  },
  SOURCE_UNAVAILABLE: {
    pill: "bg-slate-100 text-slate-700 ring-1 ring-slate-300",
    dot: "bg-slate-400",
    icon: <CircleHelp size={14} aria-hidden="true" />,
  },
  STALE: {
    pill: "bg-orange-50 text-orange-800 ring-1 ring-orange-200",
    dot: "bg-orange-400",
    icon: <Clock size={14} aria-hidden="true" />,
  },
  NOT_VALIDATED: {
    pill: "bg-slate-100 text-slate-600 ring-1 ring-slate-300",
    dot: "bg-slate-300",
    icon: <CircleHelp size={14} aria-hidden="true" />,
  },
};

function StatusPill({ status, lang }: { status: ReconciliationStatus; lang: "ar" | "en" }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${style.pill}`}
    >
      {style.icon}
      {STATUS_TEXT[status][lang]}
    </span>
  );
}

const value = (amount: number | null, unit: "usd" | "count") =>
  amount === null ? "—" : unit === "usd" ? fmtUSDFull(amount) : fmtNum(amount);

function relativeTime(iso: string, lang: "ar" | "en"): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return lang === "ar" ? "الآن" : "just now";
  if (minutes < 60) return lang === "ar" ? `منذ ${fmtNum(minutes)} دقيقة` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === "ar" ? `منذ ${fmtNum(hours)} ساعة` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  return lang === "ar" ? `منذ ${fmtNum(days)} يوم` : `${days} d ago`;
}

/* -- one checked number ---------------------------------------------------- */

function CheckRow({ item, lang }: { item: ReconciliationCheck; lang: "ar" | "en" }) {
  const [open, setOpen] = useState(false);
  const A = lang === "ar";
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex w-full min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-start hover:bg-surface-2 sm:px-5"
      >
        <span className={`size-2 shrink-0 rounded-full ${STATUS_STYLE[item.status].dot}`} />
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-text">
          {item.label[lang]}
        </span>
        <span className="num shrink-0 text-[13px] text-text-muted">
          {value(item.dashboardValue, item.unit)}
        </span>
        <StatusPill status={item.status} lang={lang} />
        <ChevronDown
          size={16}
          className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-4 bg-surface-2 px-4 pb-4 pt-1 sm:px-5">
          <p className="max-w-[72ch] text-[13px] leading-relaxed text-text-soft">
            {item.note[lang]}
          </p>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label={A ? "الرقم في المصدر" : "In the source"}
              body={value(item.sourceValue, item.unit)}
            />
            <Figure
              label={A ? "الرقم في الداشبورد" : "On the dashboard"}
              body={value(item.dashboardValue, item.unit)}
            />
            <Figure
              label={A ? "الفرق" : "Difference"}
              body={
                item.difference === null
                  ? "—"
                  : `${item.difference > 0 ? "+" : ""}${value(item.difference, item.unit)}`
              }
              tone={
                item.difference === null || item.difference === 0
                  ? "quiet"
                  : item.status === "MISMATCH"
                    ? "bad"
                    : "warn"
              }
            />
            <Figure
              label={A ? "آخر مراجعة" : "Last checked"}
              body={relativeTime(item.lastCheckedAt, lang) || "—"}
            />
          </dl>

          <p className="text-[12.5px] leading-relaxed text-text-muted">
            {STATUS_WHY[item.status][lang]}
          </p>

          {item.unavailableReason && <Notice tone="warning">{item.unavailableReason}</Notice>}

          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-semibold text-text-muted hover:text-text [&::-webkit-details-marker]:hidden">
              <ChevronDown
                size={14}
                className="transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
              {A ? "تفاصيل تقنية" : "Technical details"}
            </summary>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
              <Tech label={A ? "النظام" : "System"} body={item.sourceSystem} />
              <Tech label={A ? "المكان في النظام" : "Source entity"} body={item.sourceEntity} />
              <Tech label={A ? "معرّف المقياس" : "Metric id"} body={item.metricId} />
              <Tech
                label={A ? "الفترة" : "Period"}
                body={`${item.period.from} → ${item.period.to}`}
              />
              <Tech
                label={A ? "نسبة الفرق" : "Difference %"}
                body={
                  item.differencePercent === null
                    ? "—"
                    : `${item.differencePercent > 0 ? "+" : ""}${item.differencePercent.toFixed(2)}%`
                }
              />
              <Tech
                label={A ? "الصفحات اللي بتعتمد عليه" : "Affected pages"}
                body={item.affectedPages.join("  ·  ") || "—"}
              />
            </dl>
          </details>
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  body,
  tone = "quiet",
}: {
  label: string;
  body: string;
  tone?: "quiet" | "warn" | "bad";
}) {
  const colour =
    tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-text";
  return (
    <div className="rounded-lg bg-surface px-3 py-2.5 ring-1 ring-border">
      <dt className="text-[11.5px] font-medium text-text-muted">{label}</dt>
      <dd className={`num mt-0.5 text-[15px] font-semibold ${colour}`}>{body}</dd>
    </div>
  );
}

function Tech({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-medium text-text-muted">{label}:</dt>
      <dd className="num min-w-0 break-words text-text-soft">{body}</dd>
    </div>
  );
}

/* -- one source ------------------------------------------------------------ */

function SourceCard({ group, lang }: { group: SourceGroup; lang: "ar" | "en" }) {
  const A = lang === "ar";
  const synced = relativeTime(group.syncedAt, lang);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
        <span className={`size-2.5 shrink-0 rounded-full ${STATUS_STYLE[group.status].dot}`} />
        <h3 className="text-[14px] font-semibold text-text">{group.label[lang]}</h3>
        <StatusPill status={group.status} lang={lang} />
        {synced && (
          <span className="ms-auto text-[12px] text-text-muted">
            {A ? `آخر تحديث: ${synced}` : `updated ${synced}`}
          </span>
        )}
      </div>
      {group.unavailableReason && (
        <div className="px-4 pb-3 sm:px-5">
          <Notice tone="warning">{group.unavailableReason}</Notice>
        </div>
      )}
      <div className="border-t border-border">
        {group.checks.map((item) => (
          <CheckRow key={item.metricId} item={item} lang={lang} />
        ))}
      </div>
    </Card>
  );
}

/* -- the page -------------------------------------------------------------- */

function NumberReview() {
  const { lang, t } = useI18n();
  const A = lang === "ar";
  const filters = useFilters();
  const period = useReportingPeriod();
  const query = useMemo(
    () => buildQuery({ from: filters.from, to: filters.to }),
    [filters.from, filters.to],
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery<SourceReconciliation>({
    queryKey: ["source-reconciliation", query],
    queryFn: async () => {
      const response = await fetch(`/api/source-reconciliation${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    // Each run calls four external APIs; do not re-ask on every focus.
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const headline = useMemo(() => {
    if (!data) return null;
    const bad = data.summary.MISMATCH;
    const unknown = data.summary.SOURCE_UNAVAILABLE + data.summary.NOT_VALIDATED;
    const ok = data.summary.MATCHED;
    if (bad > 0) {
      return {
        tone: "bad" as const,
        text: A
          ? `${fmtNum(bad)} رقم مش مطابق للمصدر. ابدأ بيهم.`
          : `${bad} number${bad === 1 ? "" : "s"} do not match their source. Start there.`,
      };
    }
    if (unknown > 0) {
      return {
        tone: "warn" as const,
        text: A
          ? `كل اللي قدرنا نراجعه مطابق (${fmtNum(ok)}), بس فيه ${fmtNum(unknown)} محدش يقدر يتأكد منهم.`
          : `Everything we could check matches (${ok}), but ${unknown} cannot be verified by anyone.`,
      };
    }
    return {
      tone: "good" as const,
      text: A
        ? `كل الأرقام (${fmtNum(ok)}) اتراجعت على مصادرها وطلعت مطابقة.`
        : `All ${ok} numbers were checked against their own sources and matched.`,
    };
  }, [data, A]);

  return (
    <>
      <DashboardPageHeader
        icon={<ShieldCheck size={18} />}
        title={t("number_review")}
        subtitle={
          A
            ? "كل رقم مهم بنسأل عنه النظام اللي جاي منه، ونقول لك طلع مطابق ولا لأ. الأخضر هنا معناه اتأكدنا من المصدر نفسه، مش إن صفحتين في الداشبورد متفقين."
            : "Every important number is checked against the system it came from. Green here means the source itself confirmed it, not that two dashboard pages agree."
        }
        period={period}
        tone="sky"
        sync={
          data ? (
            <span>
              {A ? "آخر مراجعة: " : "last checked "}
              {relativeTime(data.generatedAt, lang)}
            </span>
          ) : undefined
        }
        actions={
          <button
            type="button"
            onClick={() => {
              void fetch(`/api/source-reconciliation${query}${query ? "&" : "?"}force=1`).then(() =>
                refetch(),
              );
            }}
            disabled={isFetching}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-surface-2 px-3 text-[13px] font-semibold text-text ring-1 ring-border hover:bg-surface-3 disabled:opacity-60"
          >
            <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} aria-hidden="true" />
            {A ? "راجع تاني" : "Check again"}
          </button>
        }
      />

      {error && (
        <ErrorState
          message={
            A ? "مقدرناش نجيب نتيجة المراجعة." : "The reconciliation report could not be loaded."
          }
          onRetry={() => void refetch()}
        />
      )}

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-40 w-full" />
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-[var(--gap-section)]">
          {headline && (
            <Notice
              tone={
                headline.tone === "bad" ? "danger" : headline.tone === "warn" ? "warning" : "info"
              }
            >
              {headline.text}
            </Notice>
          )}

          <div>
            <SectionTitle
              hint={
                A
                  ? "اضغط على أي رقم تشوف جاي منين وفرقه كام"
                  : "Open any number to see where it came from and by how much it differs"
              }
            >
              {A ? "المصادر" : "Sources"}
            </SectionTitle>
            <div className="space-y-4">
              {data.groups.map((group) => (
                <SourceCard key={group.key} group={group} lang={lang} />
              ))}
            </div>
          </div>

          <p className="text-[12px] leading-relaxed text-text-muted">
            {A
              ? `المراجعة دي بتسأل Odoo وMeta وTikTok وGoogle على طول، وبتتخزن ١٠ دقايق. أخدت ${fmtNum(
                  Math.round(data.durationMs / 100) / 10,
                )} ثانية.`
              : `This report asks Odoo, Meta, TikTok and Google directly and is cached for ten minutes. It took ${
                  Math.round(data.durationMs / 100) / 10
                } s.`}
          </p>
        </div>
      )}
    </>
  );
}
