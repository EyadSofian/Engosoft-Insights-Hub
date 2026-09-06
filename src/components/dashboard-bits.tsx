import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Info,
  Lightbulb,
  Trophy,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { TONE, type Tone } from "@/lib/dashboard-tone";
import { Card } from "./ui-bits";

/* -------------------------------------------------------------------------
   The presentation layer every analytical page shares.

   These components carry no business logic and fetch nothing: they take
   values a page has already computed from its own API response and place
   them. Anything that decides *what* a number means stays in the page or in
   lib/, so the same figure can be reformatted without a calculation moving.
------------------------------------------------------------------------- */

/* --- page header --------------------------------------------------------- */

/**
 * The one heading a page owns.
 *
 * The top bar carries controls and never repeats a title, so this is the only
 * place a reader is told which report they are on, which window it covers and
 * how fresh it is — three facts that used to be spread across three different
 * strips.
 */
export function DashboardPageHeader({
  icon,
  title,
  subtitle,
  period,
  sync,
  actions,
  children,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  /** The reporting window in words. Omitted when the page is not date-scoped. */
  period?: string;
  /** Quiet freshness line. Pass nothing rather than inventing a time. */
  sync?: ReactNode;
  actions?: ReactNode;
  /** Sub-navigation, rendered under the heading rule. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-4 sm:mb-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5">
        {/* `flex-1` alone let this collapse: with `flex-wrap` on the row and a
            `shrink-0` chip group beside it, a basis of 0 meant the heading
            gave up all its width rather than pushing the chips onto their own
            line — the page title rendered as one letter per line on a phone.
            Claiming the full row below `sm` makes the chips wrap instead. */}
        <div className="flex w-full min-w-0 items-start gap-3 sm:w-auto sm:flex-1">
          {icon && (
            <span
              className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl sm:size-11"
              style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-balance text-[19px] font-semibold leading-tight text-text min-[420px]:text-[21px] sm:text-2xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 text-[12px] leading-snug text-text-muted sm:text-[13px]">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {period && (
            <span className="inline-flex max-w-full items-center rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-muted sm:text-[12px]">
              <bdi className="num truncate">{period}</bdi>
            </span>
          )}
          {sync}
          {actions}
        </div>
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </header>
  );
}

/**
 * A one-line freshness readout for the page header.
 *
 * Deliberately says nothing when there is no timestamp: a dash where a time
 * should be reads as "the data is broken", which is a different claim.
 */
export function SyncStatus({ label, tone = "success" }: { label?: string; tone?: Tone }) {
  if (!label) return null;
  const style = TONE[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted sm:text-[12px]">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: style.fg }}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

/* --- KPI row ------------------------------------------------------------- */

/**
 * The first row of a report: four to six figures, never twelve.
 *
 * `columns` is the count at the widest breakpoint. Below that the row steps
 * down to three, then two — a KPI is a number to be read at a glance, and a
 * single column of them on a phone is a list, not a glance.
 */
export function KpiRow({
  children,
  columns = 5,
  className = "",
}: {
  children: ReactNode;
  columns?: 4 | 5 | 6;
  className?: string;
}) {
  const wide = {
    4: "xl:grid-cols-4",
    5: "xl:grid-cols-5",
    6: "xl:grid-cols-6",
  }[columns];
  return (
    <div
      className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 ${wide} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Everything that did not earn a place in the first row.
 *
 * Collapsed by default and labelled with how many figures are inside, so the
 * detail is one click away rather than competing with the headline numbers.
 */
export function SecondaryMetrics({
  label,
  count,
  children,
  defaultOpen = false,
}: {
  label?: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const { lang } = useI18n();
  const heading = label ?? (lang === "ar" ? "مؤشرات إضافية" : "More metrics");
  return (
    <details className="group card overflow-hidden" open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-text [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">{heading}</span>
        {count !== undefined && (
          <span className="num rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-muted">
            {count}
          </span>
        )}
        <ChevronDownGlyph />
      </summary>
      <div className="border-t border-border p-2.5 sm:p-3.5">{children}</div>
    </details>
  );
}

function ChevronDownGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-text-muted transition-transform duration-150 group-open:rotate-180"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/* --- insights ------------------------------------------------------------ */

export type InsightKind = "best" | "attention" | "opportunity" | "note";

const INSIGHT_TONE: Record<InsightKind, Tone> = {
  best: "success",
  attention: "danger",
  opportunity: "brand",
  note: "violet",
};

const INSIGHT_ICON = {
  best: Trophy,
  attention: AlertTriangle,
  opportunity: Lightbulb,
  note: Info,
} as const;

const INSIGHT_LABEL: Record<InsightKind, { ar: string; en: string }> = {
  best: { ar: "أفضل نتيجة", en: "Best result" },
  attention: { ar: "يحتاج متابعة", en: "Needs attention" },
  opportunity: { ar: "فرصة", en: "Opportunity" },
  note: { ar: "ملاحظة", en: "Note" },
};

/**
 * One reading of the period, stated as a sentence somebody can act on.
 *
 * The eyebrow carries the verdict in words as well as in colour, because a
 * reader who cannot separate the green card from the red one still has to be
 * able to tell "best result" from "needs attention".
 */
export function InsightCard({
  kind,
  eyebrow,
  title,
  value,
  detail,
  to,
  search,
  onClick,
  actionLabel,
  index = 0,
}: {
  kind: InsightKind;
  /** Overrides the default eyebrow wording. */
  eyebrow?: string;
  title: ReactNode;
  /** The one figure this insight turns on, if it has one. */
  value?: ReactNode;
  detail?: ReactNode;
  /** Route this insight drills into. */
  to?: string;
  search?: Record<string, unknown>;
  onClick?: () => void;
  actionLabel?: string;
  index?: number;
}) {
  const { lang } = useI18n();
  const tone = TONE[INSIGHT_TONE[kind]];
  const Icon = INSIGHT_ICON[kind];
  const label = eyebrow ?? INSIGHT_LABEL[kind][lang];
  const interactive = Boolean(to || onClick);

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
          style={{ background: tone.bg, color: tone.fg }}
        >
          <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
          {label}
        </span>
        {interactive && (
          <span className="shrink-0 text-text-subtle" aria-hidden="true">
            {lang === "ar" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="min-w-0 text-[13.5px] font-semibold leading-snug text-text sm:text-sm">
          {title}
        </span>
        {value != null && (
          <span className="num text-[15px] font-semibold sm:text-base" style={{ color: tone.fg }}>
            {value}
          </span>
        )}
      </div>

      {detail != null && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-text-muted">{detail}</p>
      )}
      {interactive && actionLabel && (
        <span className="mt-2 inline-block text-[11.5px] font-semibold text-brand">
          {actionLabel}
        </span>
      )}
    </>
  );

  const shell =
    "card stagger block min-w-0 p-3.5 text-start sm:p-4 " +
    (interactive
      ? "card-hover cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      : "");
  const style = {
    "--i": index,
    background: tone.bg,
    borderColor: tone.border,
  } as React.CSSProperties;

  if (to) {
    return (
      <Link to={to} search={search as never} className={shell} style={style}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${shell} w-full`} style={style}>
        {body}
      </button>
    );
  }
  return (
    <div className={shell} style={style}>
      {body}
    </div>
  );
}

/** One to three insights across the width. Renders nothing when it is empty. */
export function InsightRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`grid gap-2.5 sm:gap-3 lg:grid-cols-3 ${className}`}>{children}</div>;
}

/* --- panels -------------------------------------------------------------- */

/**
 * A titled block holding one chart, table or ranking.
 *
 * One padding, one hairline, one very light shadow — repeated everywhere, so
 * a page reads as a grid of comparable things rather than a pile of cards of
 * differing weight.
 */
export function DashboardPanel({
  title,
  hint,
  icon,
  action,
  children,
  className = "",
  bodyClassName = "",
  footer,
}: {
  title?: ReactNode;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
}) {
  return (
    <section className={`card flex min-w-0 flex-col ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-border px-3.5 py-3 sm:px-5 sm:py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold leading-snug text-text sm:text-[15px]">
              {icon && (
                <span className="shrink-0 text-text-muted" aria-hidden="true">
                  {icon}
                </span>
              )}
              <span className="min-w-0">{title}</span>
            </h2>
            {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-text-muted">{hint}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={`min-w-0 flex-1 p-3.5 sm:p-5 ${bodyClassName}`}>{children}</div>
      {footer && (
        <div className="border-t border-border px-3.5 py-2.5 text-[11.5px] text-text-muted sm:px-5">
          {footer}
        </div>
      )}
    </section>
  );
}

/* --- data health --------------------------------------------------------- */

export interface DataHealthIssue {
  /** What the reader needs to know, in their own language. */
  message: string;
  /** How it changes the figures on this page. Never omit when it does. */
  impact?: string;
  tone: "warning" | "danger" | "info";
  /** Source names, tab names, provider errors — reader-hostile, so folded away. */
  technical?: string;
}

/**
 * The page's data-quality statement.
 *
 * Two rules hold this together. Anything that changes what the numbers mean is
 * said in plain language, always, at the top — hiding it would be lying about
 * the figures. And the machinery behind it — which tab failed, which provider
 * timed out, which stage was excluded — is folded into a disclosure, because
 * naming an internal worksheet tells a sales manager nothing they can act on.
 */
export function DataHealthSummary({
  issues,
  syncedLabel,
  className = "",
}: {
  issues: DataHealthIssue[];
  /** When the dashboard last pulled its sources, already formatted. */
  syncedLabel?: string;
  className?: string;
}) {
  const { lang } = useI18n();
  const technical = issues.filter((issue) => issue.technical);
  // An informational note about how a figure is defined is not a problem with
  // it. Only a warning or a failure may turn the headline amber or red —
  // otherwise every page would permanently claim its data needed review.
  const worst: "danger" | "warning" | "ok" = issues.some((i) => i.tone === "danger")
    ? "danger"
    : issues.some((i) => i.tone === "warning")
      ? "warning"
      : "ok";

  const headline =
    worst === "ok"
      ? issues.length
        ? lang === "ar"
          ? "كل المصادر متصلة — مع ملاحظات على تعريف الأرقام"
          : "All sources connected — with notes on how the figures are defined"
        : lang === "ar"
          ? "كل المصادر متصلة وتعمل بشكل طبيعي"
          : "All sources are connected and healthy"
      : worst === "danger"
        ? lang === "ar"
          ? "الأرقام لا تشمل كل المصادر"
          : "The figures do not include every source"
        : lang === "ar"
          ? "توجد بيانات تحتاج مراجعة"
          : "Some data needs review";

  const tone = worst === "danger" ? TONE.danger : worst === "warning" ? TONE.warning : TONE.success;
  const StatusIcon = worst === "ok" ? CircleCheck : AlertTriangle;

  return (
    <section className={`card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-3 sm:px-5">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg"
          style={{ background: tone.bg, color: tone.fg }}
        >
          <StatusIcon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold text-text sm:text-sm">
            {lang === "ar" ? "صحة البيانات" : "Data health"}
          </h2>
          <p className="text-[11.5px] leading-snug text-text-muted">{headline}</p>
        </div>
        {syncedLabel && (
          <span className="num shrink-0 text-[11px] text-text-muted">{syncedLabel}</span>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="space-y-2 border-t border-border px-3.5 py-3 sm:px-5">
          {issues.map((issue, i) => {
            const style =
              issue.tone === "danger"
                ? TONE.danger
                : issue.tone === "warning"
                  ? TONE.warning
                  : TONE.brand;
            return (
              <li key={i} className="flex items-start gap-2.5 text-[12px] leading-relaxed">
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ background: style.fg }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="text-text">{issue.message}</span>
                  {issue.impact && (
                    <span className="block text-[11px] text-text-muted">{issue.impact}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {technical.length > 0 && (
        <details className="group border-t border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-[11.5px] font-medium text-text-muted transition-colors hover:text-text sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="flex-1">{lang === "ar" ? "تفاصيل تقنية" : "Technical details"}</span>
            <ChevronDownGlyph />
          </summary>
          <ul className="space-y-1.5 px-3.5 pb-3 sm:px-5">
            {technical.map((issue, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-text-subtle">
                <bdi className="nexus-ltr">{issue.technical}</bdi>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* --- summary strip ------------------------------------------------------- */

/**
 * A short prose read of the period, above the figures.
 *
 * On a phone it collapses: the executive paragraph is worth reading, but not
 * worth pushing five KPIs below the fold to reach.
 */
export function ExecutiveSummary({ title, children }: { title: string; children: ReactNode }) {
  const { lang } = useI18n();
  return (
    <>
      <details className="group card overflow-hidden sm:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="text-[13px] font-semibold text-text">{title}</span>
          <span className="flex items-center gap-2 text-[10.5px] text-text-muted">
            {lang === "ar" ? "اضغط للقراءة" : "Tap to read"}
            <ChevronDownGlyph />
          </span>
        </summary>
        <div className="max-h-[58dvh] overflow-y-auto border-t border-border px-3.5 py-3">
          <p className="text-[12px] leading-relaxed text-text-muted">{children}</p>
        </div>
      </details>

      {/* The generated summary can run to a dozen lines. It is worth reading,
          but not worth pushing the five headline figures below the fold to
          reach, so on desktop it opens clamped to four lines and expands in
          place. The text itself is untouched — this is a height, not an edit. */}
      <details className="group card hidden overflow-hidden sm:block">
        <summary className="flex cursor-pointer list-none items-start gap-3 p-3.5 sm:p-5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-text">{title}</span>
            <span className="mt-1.5 line-clamp-4 block text-[13px] leading-relaxed text-text-muted group-open:hidden sm:text-sm">
              {children}
            </span>
          </span>
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-brand">
            <span className="group-open:hidden">{lang === "ar" ? "اقرأ الكل" : "Read all"}</span>
            <span className="hidden group-open:inline">{lang === "ar" ? "طيّ" : "Collapse"}</span>
            <ChevronDownGlyph />
          </span>
        </summary>
        <p className="px-3.5 pb-3.5 text-[13px] leading-relaxed text-text-muted sm:px-5 sm:pb-5 sm:text-sm">
          {children}
        </p>
      </details>
    </>
  );
}
