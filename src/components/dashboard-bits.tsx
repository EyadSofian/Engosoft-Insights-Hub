import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  LayoutGrid,
  Lightbulb,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { toneOf, toneVars, TONE, type AnyTone, type Tone } from "@/lib/dashboard-tone";
import { Card, EmptyState } from "./ui-bits";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";

/* -------------------------------------------------------------------------
   The presentation layer every analytical page shares.

   These components carry no business logic and fetch nothing: they take
   values a page has already computed from its own API response and place
   them. Anything that decides *what* a number means stays in the page or in
   lib/, so the same figure can be reformatted without a calculation moving.
------------------------------------------------------------------------- */

/* --- page header ---------------------------------------------------------- */

/**
 * The one heading a page owns.
 *
 * Deliberately short: a tinted icon tile, a strong title, one line of context,
 * and the window and freshness as small type on the same row. The top bar
 * carries controls and never repeats a title, so this is the only place a
 * reader is told which report they are on — and it must not cost more than
 * about 70px of the first screen.
 */
export function DashboardPageHeader({
  icon,
  title,
  subtitle,
  period,
  sync,
  actions,
  tone = "sky",
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
  /** The section's colour family, on the icon tile. */
  tone?: AnyTone;
  /** Sub-navigation, rendered under the heading rule. */
  children?: ReactNode;
}) {
  const t = toneOf(tone);
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
          {icon && (
            <span
              className="grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-sm"
              style={{ background: t.strong }}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-balance text-[21px] font-bold leading-tight tracking-[-0.02em] text-text sm:text-[26px]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-text-muted sm:text-[13px]">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {period && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-text-muted">
              <CalendarDays size={13} className="shrink-0" aria-hidden="true" />
              <bdi className="num truncate">{period}</bdi>
            </span>
          )}
          {sync}
          {actions}
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

/**
 * A one-line freshness readout for the page header.
 *
 * Says nothing when there is no timestamp: a dash where a time should be reads
 * as "the data is broken", which is a different claim.
 */
export function SyncStatus({ label, tone = "mint" }: { label?: string; tone?: AnyTone }) {
  if (!label) return null;
  const t = toneOf(tone);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11.5px] font-medium"
      style={{ background: t.surface, color: t.ink }}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: t.strong }}
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
 * `columns` is the count at the widest breakpoint. Below that it steps down to
 * three, then two — a KPI is a number read at a glance, and a single column of
 * them on a phone is a list, not a glance.
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
  const wide = { 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" }[columns];
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${wide} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Everything that did not earn a place in the first row.
 *
 * Collapsed, labelled with how many figures are inside, so the detail is one
 * click away rather than competing with the headline numbers.
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
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-text [&::-webkit-details-marker]:hidden sm:px-5">
        <LayoutGrid size={15} className="shrink-0 text-text-subtle" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{heading}</span>
        {count !== undefined && (
          <span className="num rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-text-muted">
            {count}
          </span>
        )}
        <ChevronDownGlyph />
      </summary>
      <div className="border-t border-border p-3 sm:p-4">{children}</div>
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
  best: "mint",
  attention: "rose",
  opportunity: "sky",
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
 * One reading of the period, stated as something somebody can act on.
 *
 * The eyebrow carries the verdict in words as well as in colour, because a
 * reader who cannot separate the mint card from the rose one still has to be
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
  const tone = INSIGHT_TONE[kind];
  const t = toneOf(tone);
  const Icon = INSIGHT_ICON[kind];
  const label = eyebrow ?? INSIGHT_LABEL[kind][lang];
  const interactive = Boolean(to || onClick);

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: "var(--tone-strong)" }}
        >
          <span
            className="grid size-6 shrink-0 place-items-center rounded-lg text-white"
            style={{ background: "var(--tone-strong)" }}
          >
            <Icon size={13} strokeWidth={2.6} aria-hidden="true" />
          </span>
          {label}
        </span>
        {interactive && (
          <span
            className="shrink-0 opacity-45 transition-transform group-hover:translate-x-0 rtl:group-hover:-translate-x-0"
            style={{ color: "var(--tone-ink)" }}
            aria-hidden="true"
          >
            {lang === "ar" ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
          </span>
        )}
      </div>

      {value != null && (
        <div
          className="num mt-2.5 text-[24px] font-bold leading-none tracking-[-0.03em]"
          style={{ color: "var(--tone-ink)" }}
        >
          {value}
        </div>
      )}

      <div
        className={`text-[13.5px] font-semibold leading-snug ${value != null ? "mt-1.5" : "mt-2.5"}`}
        style={{ color: "var(--tone-ink)" }}
      >
        {title}
      </div>

      {detail != null && (
        <p
          className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed"
          style={{ color: "var(--tone-ink)", opacity: 0.7 }}
        >
          {detail}
        </p>
      )}
      {interactive && actionLabel && (
        <span
          className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-bold"
          style={{ color: "var(--tone-strong)" }}
        >
          {actionLabel}
        </span>
      )}
    </>
  );

  const shell =
    "tone-surface stagger group relative block min-w-0 overflow-hidden p-4 text-start " +
    (interactive
      ? "lift cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      : "");
  const style = { ...toneVars(tone), "--i": index } as React.CSSProperties;

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

/** One to three insights across the width. */
export function InsightRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`grid gap-3 lg:grid-cols-3 ${className}`}>{children}</div>;
}

/* --- panels -------------------------------------------------------------- */

/**
 * A titled white block holding one chart, table or ranking.
 *
 * White on the tinted canvas, one hairline, generous padding. The KPI cards
 * above it are coloured, so the analysis below reads as a different kind of
 * thing rather than more of the same.
 */
export function DashboardPanel({
  title,
  hint,
  icon,
  tone = "sky",
  action,
  children,
  className = "",
  bodyClassName = "",
  footer,
}: {
  title?: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: AnyTone;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
}) {
  const t = toneOf(tone);
  return (
    <section className={`card flex min-w-0 flex-col overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span
                className="grid size-8 shrink-0 place-items-center rounded-xl"
                style={{ background: t.surface, color: t.strong }}
                aria-hidden="true"
              >
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold leading-snug tracking-[-0.01em] text-text">
                {title}
              </h2>
              {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-text-muted">{hint}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={`min-w-0 flex-1 px-4 pb-4 sm:px-5 sm:pb-5 ${bodyClassName}`}>{children}</div>
      {footer && (
        <div className="border-t border-border bg-surface-2 px-4 py-2.5 text-[11.5px] text-text-muted sm:px-5">
          {footer}
        </div>
      )}
    </section>
  );
}

/* --- ranking ------------------------------------------------------------- */

export interface RankingItem {
  key: string;
  label: string;
  /** Already formatted for display. */
  value: string;
  /** 0..1 — how far this bar fills. Omit and it is computed from `raw`. */
  ratio?: number;
  raw?: number;
  meta?: string;
  to?: string;
}

/**
 * Top three to five of something, as a ranked list with a bar each.
 *
 * A short ranking answers "which one is winning" faster than a table with the
 * same rows in it, and it costs a quarter of the height. The full list stays
 * one click away through `moreTo`.
 */
export function RankingPanel({
  title,
  hint,
  icon,
  tone = "sky",
  items,
  moreTo,
  moreLabel,
  emptyLabel,
  limit = 5,
}: {
  title: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: AnyTone;
  items: RankingItem[];
  moreTo?: string;
  moreLabel?: string;
  emptyLabel?: string;
  limit?: number;
}) {
  const { lang } = useI18n();
  const t = toneOf(tone);
  const shown = items.slice(0, limit);
  const peak = Math.max(...shown.map((i) => Math.abs(i.raw ?? i.ratio ?? 0)), 1);

  return (
    <DashboardPanel
      title={title}
      hint={hint}
      icon={icon}
      tone={tone}
      action={
        moreTo ? (
          <Link
            to={moreTo}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-bold text-brand hover:bg-brand-soft"
          >
            {moreLabel ?? (lang === "ar" ? "عرض الكل" : "View all")}
            {lang === "ar" ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </Link>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <EmptyState label={emptyLabel ?? (lang === "ar" ? "لا توجد بيانات" : "No data")} compact />
      ) : (
        <ol className="space-y-2.5">
          {shown.map((item, i) => {
            const width = Math.max(4, (Math.abs(item.raw ?? item.ratio ?? 0) / peak) * 100);
            const row = (
              <>
                <span
                  className="num grid size-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
                  style={
                    i === 0
                      ? { background: t.strong, color: "#fff" }
                      : { background: t.surface, color: t.ink }
                  }
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-medium text-text" title={item.label}>
                      {item.label}
                    </span>
                    <span className="num shrink-0 text-[13px] font-bold text-text">
                      {item.value}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <span
                      className="block h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${width}%`, background: t.strong }}
                    />
                  </span>
                  {item.meta && (
                    <span className="mt-1 block truncate text-[10.5px] text-text-muted">
                      {item.meta}
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={item.key}>
                {item.to ? (
                  <Link
                    to={item.to}
                    className="-mx-1.5 flex items-start gap-2.5 rounded-xl px-1.5 py-1 transition-colors hover:bg-surface-2"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2.5">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </DashboardPanel>
  );
}

/* --- compact table ------------------------------------------------------- */

/**
 * A dense table on a light header, for detail that sits below the summary.
 *
 * Presentation only — it does not sort, filter or paginate. Pages that already
 * own those behaviours keep them and pass rows in.
 */
export function CompactTable({
  head,
  children,
  minWidth = 640,
  className = "",
}: {
  head: ReactNode;
  children: ReactNode;
  minWidth?: number;
  className?: string;
}) {
  return (
    <div className={`table-wrap scroll-hint-x -mx-1 px-1 ${className}`}>
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr className="text-[10.5px] font-bold uppercase tracking-wide text-text-subtle">
            {head}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-border [&>tr:hover]:bg-surface-2">
          {children}
        </tbody>
      </table>
    </div>
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

function healthLevel(issues: DataHealthIssue[]): "danger" | "warning" | "ok" {
  if (issues.some((i) => i.tone === "danger")) return "danger";
  if (issues.some((i) => i.tone === "warning")) return "warning";
  return "ok";
}

/**
 * The page's data-quality statement, as one small control.
 *
 * Two rules hold this together. Anything that changes what the numbers mean is
 * said in plain language — hiding it would be lying about the figures. And the
 * machinery behind it (which tab failed, which provider timed out, which stage
 * was excluded) is folded away, because naming an internal worksheet tells a
 * sales manager nothing they can act on.
 *
 * It is a chip, not a panel: it lives at the foot of the page or in a header,
 * and opens a sheet when pressed. The previous full-width card was competing
 * with the analysis for a reader who, nine times out of ten, only needed to
 * see that it was green.
 */
export function DataHealthButton({
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
  const [open, setOpen] = useState(false);
  const level = healthLevel(issues);
  const tone: Tone = level === "danger" ? "rose" : level === "warning" ? "amber" : "mint";
  const t = toneOf(tone);
  const StatusIcon = level === "ok" ? ShieldCheck : AlertTriangle;
  const technical = issues.filter((issue) => issue.technical);

  const headline =
    level === "ok"
      ? lang === "ar"
        ? "كل المصادر متصلة"
        : "All sources connected"
      : level === "danger"
        ? lang === "ar"
          ? "الأرقام لا تشمل كل المصادر"
          : "Figures exclude some sources"
        : lang === "ar"
          ? "بيانات تحتاج مراجعة"
          : "Data needs review";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-start transition-colors ${className}`}
        style={{ background: t.surface, borderColor: t.border, color: t.ink }}
        aria-haspopup="dialog"
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-xl text-white"
          style={{ background: t.strong }}
        >
          <StatusIcon size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-bold leading-tight">{headline}</span>
          <span className="block text-[11px] leading-tight opacity-70">
            {issues.length > 0
              ? lang === "ar"
                ? `${issues.length} ملاحظة · اضغط للتفاصيل`
                : `${issues.length} note${issues.length === 1 ? "" : "s"} · tap for detail`
              : (syncedLabel ?? (lang === "ar" ? "اضغط لعرض صحة البيانات" : "Tap for data health"))}
          </span>
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={lang === "ar" ? "left" : "right"}
          className="w-[min(100vw,26rem)] overflow-y-auto border-border bg-surface p-0"
        >
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{ background: t.surface, color: t.ink }}
          >
            <span
              className="grid size-10 shrink-0 place-items-center rounded-2xl text-white"
              style={{ background: t.strong }}
            >
              <StatusIcon size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="text-[15px] font-bold" style={{ color: t.ink }}>
                {lang === "ar" ? "صحة البيانات" : "Data health"}
              </SheetTitle>
              <SheetDescription className="text-[12px]" style={{ color: t.ink, opacity: 0.75 }}>
                {headline}
              </SheetDescription>
            </div>
          </div>

          {syncedLabel && (
            <p className="num border-b border-border px-5 py-2.5 text-[11.5px] text-text-muted">
              {syncedLabel}
            </p>
          )}

          {issues.length === 0 ? (
            <p className="px-5 py-6 text-[13px] leading-relaxed text-text-muted">
              {lang === "ar"
                ? "كل المصادر تعمل بشكل طبيعي، ولا توجد ملاحظات تؤثر على الأرقام في هذه الفترة."
                : "Every source is healthy and nothing in this period affects the figures."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {issues.map((issue, i) => {
                const it = toneOf(
                  issue.tone === "danger" ? "rose" : issue.tone === "warning" ? "amber" : "sky",
                );
                return (
                  <li key={i} className="px-5 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full"
                        style={{ background: it.strong }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium leading-relaxed text-text">
                          {issue.message}
                        </p>
                        {issue.impact && (
                          <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
                            {issue.impact}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {technical.length > 0 && (
            <details className="group border-t border-border">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-[11.5px] font-semibold text-text-muted hover:text-text [&::-webkit-details-marker]:hidden">
                <span className="flex-1">
                  {lang === "ar" ? "تفاصيل تقنية" : "Technical details"}
                </span>
                <ChevronDownGlyph />
              </summary>
              <ul className="space-y-2 px-5 pb-5">
                {technical.map((issue, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-text-subtle">
                    <bdi className="nexus-ltr">{issue.technical}</bdi>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The chip, laid out as a full-width strip for the foot of a page.
 *
 * Same control and the same contract — kept under the old name so the pages
 * already calling it keep working.
 */
export function DataHealthSummary({
  issues,
  syncedLabel,
  className = "",
}: {
  issues: DataHealthIssue[];
  syncedLabel?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <DataHealthButton issues={issues} syncedLabel={syncedLabel} />
    </div>
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

/* --- source errors -------------------------------------------------------- */

/**
 * A part of the page that could not load.
 *
 * The message a reader gets is always the same plain sentence, because the
 * server's own error text is written for whoever maintains the connector: it
 * names tables, hosts and drivers, and a sales manager reading "relation
 * price_book_items does not exist" learns only that something is broken, which
 * the sentence already told them.
 *
 * The raw text is not thrown away — it is rendered in development, where the
 * person who can act on it is the person looking at the screen. In production
 * it stays out of the page entirely.
 */
export function SourceErrorNotice({
  error,
  what,
  onRetry,
}: {
  /** The server's own message. Never rendered to a production reader. */
  error?: string | null;
  /** What failed, in the reader's terms — "the price list", "this invoice". */
  what?: string;
  onRetry?: () => void;
}) {
  const { lang } = useI18n();
  if (!error) return null;

  const subject = what ?? (lang === "ar" ? "هذا الجزء من البيانات" : "this part of the report");

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-2.5 rounded-xl px-3 py-2.5 text-[13px] sm:px-4 sm:py-3"
      style={{ background: TONE.warning.bg, color: TONE.warning.fg }}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-relaxed">
        <span>
          {lang === "ar"
            ? `تعذّر تحميل ${subject}. باقي الأرقام على الصفحة غير متأثرة.`
            : `Could not load ${subject}. The rest of the figures on this page are unaffected.`}
        </span>
        {import.meta.env.DEV && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11px] font-medium opacity-80">
              {lang === "ar"
                ? "تفاصيل تقنية (تظهر في التطوير فقط)"
                : "Technical details (dev only)"}
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] opacity-90">
              {error}
            </pre>
          </details>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-current/30 px-2.5 py-1 text-[11.5px] font-semibold"
        >
          {lang === "ar" ? "إعادة المحاولة" : "Try again"}
        </button>
      )}
    </div>
  );
}

/* --- alerts --------------------------------------------------------------- */

/**
 * The one alert allowed above the figures.
 *
 * A single line, tonal, with its detail on a second line and nothing else. The
 * previous full paragraph banner took four lines of the first screen for a
 * message the reader absorbs in one — and stacked with the global freshness
 * strip it pushed the KPI row most of the way down the fold.
 */
export function AlertBar({
  tone = "rose",
  title,
  children,
  action,
}: {
  tone?: AnyTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const t = toneOf(tone);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-2.5"
      style={{ background: t.surface, borderColor: t.border, color: t.ink }}
    >
      <span className="inline-flex shrink-0 items-center gap-2 text-[12.5px] font-bold">
        <AlertTriangle size={15} aria-hidden="true" style={{ color: t.strong }} />
        {title}
      </span>
      {children && (
        <span className="min-w-0 flex-1 text-[11.5px] leading-snug opacity-80">{children}</span>
      )}
      {action}
    </div>
  );
}

/* --- supporting facts ----------------------------------------------------- */

export interface SupportingFactItem {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone?: AnyTone;
}

/**
 * Facts that are worth stating and not worth a card each.
 *
 * One bordered strip divided into columns rather than N separate cards: these
 * answer "who / which one", not "what should I do", and giving each of them a
 * full card put two nearly-empty white boxes across the page.
 */
export function SupportingFacts({ items }: { items: SupportingFactItem[] }) {
  if (!items.length) return null;
  return (
    <div className="card grid divide-y divide-border overflow-hidden sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3 rtl:sm:divide-x-reverse">
      {items.map((item) => {
        const t = toneOf(item.tone ?? "slate");
        return (
          <div key={item.key} className="flex min-w-0 items-center gap-3 px-4 py-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-xl"
              style={{ background: t.surface, color: t.strong }}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-subtle">
                {item.label}
              </div>
              <div className="truncate text-[14px] font-bold text-text" title={item.value}>
                {item.value}
              </div>
              {item.detail && (
                <div className="truncate text-[11px] text-text-muted" title={item.detail}>
                  {item.detail}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * "Where does this number come from?" — the formula, out of the card.
 *
 * A KPI has room for one line of context. The definition behind it is worth
 * keeping and is not worth three lines of a card that a reader is meant to
 * take in at a glance, so it lives on this dot.
 */
export function InfoDot({ text }: { text: string }) {
  const { lang } = useI18n();
  return (
    <span
      className="grid size-4 shrink-0 cursor-help place-items-center rounded-full text-[9px] font-bold opacity-55"
      style={{ background: "var(--tone-strong)", color: "#fff" }}
      title={text}
      role="note"
      aria-label={`${lang === "ar" ? "التعريف" : "Definition"}: ${text}`}
    >
      i
    </span>
  );
}
